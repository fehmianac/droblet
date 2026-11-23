import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, useWindowDimensions, View } from 'react-native';

import type { FeedPiece, FeedPost, FeedProduct } from '@/api/contracts/feed';
import { Icon } from '@/components/ui/Icon';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Text } from '@/components/ui/Text';
import { Zoomable, type ViewerImage } from '@/components/ui/viewer';
import { formatMoney } from '@/lib/format';
import { feedTones, spacing } from '@/theme/tokens';

import { pieceName } from './logic';

/** Gap between the two columns of the piece grid. */
const GRID_GAP = 12;
/** A tile is a little taller than wide (5 : 6), like a garment photographed flat. */
const TILE_RATIO = 1.2;

/**
 * The pieces of a look, two to a row: the clean picture whole on the sand ground, under it the piece's name (its
 * sub-type, else its kind). A tap opens the picture in the full-screen viewer (the look's pieces, pageable). Not
 * products: no price, nothing to buy.
 */
function PieceGrid({ pieces }: { pieces: FeedPiece[] }) {
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const tile = Math.max(1, Math.floor((windowWidth - spacing.gutter * 2 - GRID_GAP) / 2));
  const names = pieces.map((piece) => pieceName(t, piece));
  // The viewer pages through the pieces that have a picture.
  const viewer: ViewerImage[] = [];
  const viewerIndex = pieces.map((piece, i) => {
    if (!piece.imageUrl) return -1;
    viewer.push({ uri: piece.imageUrl, label: names[i], caption: names[i] });
    return viewer.length - 1;
  });

  return (
    <View className="flex-row flex-wrap" style={{ gap: GRID_GAP }} testID="feed.detail.pieces">
      {pieces.map((piece, i) => (
        <View key={`${piece.category}-${i}`} style={{ width: tile }} className="gap-2" testID={`feed.detail.piece.${i}`}>
          <Zoomable
            images={viewer}
            index={viewerIndex[i]}
            disabled={!piece.imageUrl}
            accessibilityLabel={t('homeFeed.detail.pieceZoomA11y', { name: names[i] })}
            style={{ width: tile, height: Math.round(tile * TILE_RATIO) }}
            className="overflow-hidden rounded-image-lg bg-sand"
            testID={`feed.detail.piece.${i}.photo`}
          >
            <ImageSlot
              uri={piece.imageUrl}
              fit="contain"
              className="h-full w-full"
              placeholder={{ kind: 'garment', category: piece.category, subcategory: piece.subcategory, glyphSize: 56 }}
            />
          </Zoomable>
          <Text variant="bodyMedium" numberOfLines={1} testID={`feed.detail.piece.${i}.name`}>
            {names[i]}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * One catalogue product of the post: 56 × 68 picture, the name, "Marka · fiyat" and — when the member has something
 * like it — "Gardırobunda var" in green. It opens the product page, as its chip on the card does. A teen sees no
 * price and the row opens nothing (the store is closed to teen accounts, canvas 18).
 */
function ProductLine({ product, teen }: { product: FeedProduct; teen: boolean }) {
  const { t } = useTranslation();
  const price = !teen && product.price ? formatMoney(product.price) : null;
  const meta = price ? `${product.brandName} · ${price}` : product.brandName;
  const label = [
    price ? t('homeFeed.piecePriceA11y', { name: product.name, brand: product.brandName, price }) : t('homeFeed.pieceA11y', { name: product.name, brand: product.brandName }),
    product.ownedSimilar ? t('homeFeed.owned') : null,
  ]
    .filter(Boolean)
    .join(', ');
  const body = (
    <>
      <View className="h-[68px] w-14 overflow-hidden rounded-[10px] bg-feed-thumb">
        <ImageSlot uri={product.imageUrl} className="h-full w-full" placeholder={{ kind: 'garment', category: product.category, color: product.colors[0], glyphSize: 26 }} />
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <Text variant="body" numberOfLines={1}>
          {product.name}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1} testID={`feed.detail.product.${product.id}.meta`}>
          {meta}
        </Text>
        {product.ownedSimilar ? (
          <Text variant="caption" className="font-sans-medium" style={{ color: feedTones.owned }} numberOfLines={1} testID={`feed.detail.product.${product.id}.owned`}>
            {t('homeFeed.owned')}
          </Text>
        ) : null}
      </View>
    </>
  );
  const rowClass = 'min-h-[84px] flex-row items-center gap-3 border-b border-line py-2';
  if (teen) {
    return (
      <View className={rowClass} accessible accessibilityLabel={label} testID={`feed.detail.product.${product.id}`}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/shop/product/[id]', params: { id: product.id } })}
      accessibilityRole="link"
      accessibilityLabel={label}
      testID={`feed.detail.product.${product.id}`}
      className={`${rowClass} active:opacity-70`}
    >
      {body}
      <Icon icon={ChevronRight} size={18} tone="muted" />
    </Pressable>
  );
}

/**
 * "Parçalar · N" on a post's detail: the catalogue products as rows (an editor post with products), or the look's
 * pieces as a two-column grid (a photograph with the pieces cut out of it, a member's look). Nothing for a post that
 * has neither.
 */
export function FeedPostPieces({ post, teen }: { post: Pick<FeedPost, 'products' | 'pieces'>; teen: boolean }) {
  const { t } = useTranslation();
  const hasProducts = post.products.length > 0;
  const count = hasProducts ? post.products.length : post.pieces.length;
  if (count === 0) return null;
  return (
    <View className="gap-3">
      <Text variant="h3" testID="feed.detail.piecesTitle">
        {t('homeFeed.detail.piecesTitle', { count })}
      </Text>
      {hasProducts ? (
        <View className="-mt-1" testID="feed.detail.products">
          {post.products.map((product) => (
            <ProductLine key={product.id} product={product} teen={teen} />
          ))}
        </View>
      ) : (
        <PieceGrid pieces={post.pieces} />
      )}
    </View>
  );
}
