import { router } from 'expo-router';
import { Bookmark, Heart, Layers, ShoppingBag, Sparkles } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { track } from '@/analytics/track';
import type { FeedPost, FeedProduct } from '@/api/contracts/feed';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ImageSlot, type Piece } from '@/components/ui/ImageSlot';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useTryOnAction } from '@/features/tryon/useTryOnAction';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { formatMoney, formatNumber } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';
import { feedTones, spacing } from '@/theme/tokens';

import { AuthorAvatar, VerifiedBadge } from './FeedBits';
import { FeedPieceStrip } from './FeedPieceStrip';
import { FeedUserPostCard } from './FeedUserPostCard';
import { BUILD_WITH_MINE_MIN, occasionLabel, ownedItemIds, postMeta } from './logic';
import { useLikeFeedPost, useSaveFeedPost } from './mutations';

type Props = {
  post: FeedPost;
  /** Teen account: no prices, no "Satın al", no buyable chip, pieces do not open the store (canvas 18). */
  teen: boolean;
  onBuy: (post: FeedPost) => void;
  /** A member's post (Akış F2): its "⋯" menu and "Benzerlerini gör" — sheets owned by the list (`useUserPostSheets`). */
  onMenu?: (post: FeedPost) => void;
  onSimilar?: (post: FeedPost) => void;
};

/** Height of the photo area on the board: 410 on a full card, 400 on a card without pieces. */
const FULL_IMAGE = 410;
const COMPACT_IMAGE = 400;

const piecesOf = (products: FeedProduct[]): Piece[] => products.map((p) => ({ category: p.category, color: p.colors[0], imageUrl: p.imageUrl }));

/** The photos, one page each: "1 / N" counter, the buyable chip and the dots under the photo (canvas 06″). */
function Carousel({ post, height, teen, overlay }: { post: FeedPost; height: number; teen: boolean; overlay?: ReactNode }) {
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  // The card sits 20 in from each edge and has a 1 pt hairline.
  const width = Math.max(1, windowWidth - spacing.gutter * 2 - 2);
  const [index, setIndex] = useState(0);
  const count = Math.max(1, post.images.length);
  // The placeholder figure wears the products; a photograph without products, its pieces.
  const pieces = post.products.length > 0 ? piecesOf(post.products) : post.pieces.map((p) => ({ category: p.category, imageUrl: p.imageUrl }));
  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width));

  return (
    <View style={{ height }} className="bg-sand">
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={count > 1}
        onMomentumScrollEnd={onScrollEnd}
        testID={`feed.post.${post.id}.carousel`}
      >
        {(post.images.length > 0 ? post.images : [null]).map((uri, i) => (
          <View key={`${post.id}-${i}`} style={{ width, height }}>
            <ImageSlot
              uri={uri}
              className="h-full w-full"
              accessibilityLabel={t('homeFeed.imageA11y', { title: post.title, index: i + 1, count })}
              placeholder={{ kind: 'look', pieces, seed: `${post.id}-${i}`, figureHeight: Math.round(height * 0.6) }}
            />
          </View>
        ))}
      </ScrollView>
      {count > 1 ? (
        <View className="absolute right-3 top-3 h-6 justify-center rounded-pill bg-feed-counter px-[9px]" pointerEvents="none" accessible={false}>
          <Text variant="badge" tone="cream" testID={`feed.post.${post.id}.counter`}>
            {t('homeFeed.imageCounter', { index: index + 1, count })}
          </Text>
        </View>
      ) : null}
      {!teen && post.products.length > 0 && post.buyableCount > 0 ? (
        <View className="absolute bottom-3 left-3 h-7 flex-row items-center gap-[5px] rounded-pill bg-feed-chip px-2.5" pointerEvents="none" testID={`feed.post.${post.id}.buyable`}>
          <Icon icon={ShoppingBag} size={13} />
          <Text variant="badge" className="text-[11.5px]">
            {t('homeFeed.buyable', { count: post.buyableCount })}
          </Text>
        </View>
      ) : null}
      {overlay}
      {count > 1 ? (
        <View className="absolute -bottom-3.5 left-0 right-0 flex-row justify-center gap-[5px]" pointerEvents="none" accessible={false}>
          {Array.from({ length: count }, (_, i) => (
            <View key={i} className={`h-1.5 w-1.5 rounded-pill ${i === index ? 'bg-ink' : 'bg-feed-dot'}`} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** One piece of the strip: thumbnail + name + "Gardırobunda var" (green) or "Marka · fiyat"; opens the product. */
function PieceChip({ product, teen }: { product: FeedProduct; teen: boolean }) {
  const { t } = useTranslation();
  const price = !teen && product.price ? formatMoney(product.price) : null;
  const meta = product.ownedSimilar ? t('homeFeed.owned') : price ? `${product.brandName} · ${price}` : product.brandName;
  const label = product.ownedSimilar
    ? t('homeFeed.pieceOwnedA11y', { name: product.name })
    : price
      ? t('homeFeed.piecePriceA11y', { name: product.name, brand: product.brandName, price })
      : t('homeFeed.pieceA11y', { name: product.name, brand: product.brandName });
  const body = (
    <>
      <View className="h-[46px] w-[46px] overflow-hidden rounded-thumb bg-feed-thumb">
        <ImageSlot uri={product.imageUrl} className="h-full w-full" placeholder={{ kind: 'garment', category: product.category, color: product.colors[0], glyphSize: 22 }} />
      </View>
      <View className="gap-px">
        <Text variant="label" className="text-[12.5px]" numberOfLines={1}>
          {product.name}
        </Text>
        <Text
          variant="caption"
          tone="muted"
          className="text-[11.5px] leading-[15px]"
          style={product.ownedSimilar ? { color: feedTones.owned } : undefined}
          numberOfLines={1}
        >
          {meta}
        </Text>
      </View>
    </>
  );
  const chipClass = 'h-[54px] flex-row items-center gap-2 rounded-image-lg border border-feed-line bg-cream py-1 pl-1 pr-3';
  // The store is closed to teen accounts (canvas 18): the piece is shown, it does not open.
  if (teen) {
    return (
      <View className={chipClass} accessible accessibilityLabel={label} testID={`feed.piece.${product.id}`}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/shop/product/[id]', params: { id: product.id } })}
      accessibilityRole="link"
      accessibilityLabel={label}
      testID={`feed.piece.${product.id}`}
      className={`${chipClass} active:opacity-80`}
    >
      {body}
    </Pressable>
  );
}

/** ♡ (accent when liked) and the bookmark, as on the board: borderless 44 targets. */
function Toggle({ icon, on, size, label, onPress, testID }: { icon: typeof Heart; on: boolean; size: number; label: string; onPress: () => void; testID: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      hitSlop={4}
      testID={testID}
      className="h-icon-btn w-icon-btn items-center justify-center rounded-pill active:opacity-70"
    >
      <Icon icon={icon} size={size} tone={on ? 'accent' : 'ink'} filled={on} />
    </Pressable>
  );
}

/**
 * One editorial post of Akış F1 (canvas 06″): author row (verified Droblet Edit), "Ofis · Sonbahar · 3 sa", the photo
 * carousel, eyebrow + serif title, the piece strip, "Üzerimde dene · 1 kredi" + "Satın al", ♡ and Kaydet, the like
 * count and the editor's note. A post without products and without pieces is the board's compact card: the try-on
 * pill sits on the photo, no title, no strip. No comments, share, follow or try-on counts (decisions 18–19).
 *
 * A photograph without products that carries the pieces cut out of it (owner decision 2026-11-23) is the full card
 * with the piece strip (picture + kind, nothing to tap) where the product strip is: nothing to buy, so no "Satın al"
 * and no buyable chip; "Üzerimde dene" dresses the whole outfit of the photograph.
 *
 * "Kendi parçalarımla kur" (under the strip, when two or more pieces are matched to wardrobe items): opens the look
 * builder (15) with those pieces in their slots and the post's occasion — the look made from what the user owns.
 */
function EditorPostCard({ post, teen, onBuy }: Pick<Props, 'post' | 'teen' | 'onBuy'>) {
  const { t } = useTranslation();
  const language = useAppLanguage();
  const like = useLikeFeedPost();
  const save = useSaveFeedPost();
  const tryOn = useTryOnAction({
    target: { kind: 'feed-post', id: post.id },
    title: post.title,
    feature: 'feed_try_on',
    // No per-post existence check (one read per card): the server answers an existing image for free.
    cachedJobId: null,
  });
  const startTryOn = () => {
    track('feed_tryon_start', { source: 'post', postId: post.id });
    tryOn.invite.onPress();
  };

  const hasProducts = post.products.length > 0;
  const compact = !hasProducts && post.pieces.length === 0;
  const meta = postMeta(t, post);
  const occasion = occasionLabel(t, post.occasion);
  const eyebrow = [t(post.author.kind === 'edit' ? 'homeFeed.eyebrowEdit' : 'homeFeed.eyebrowStylist'), occasion ? toDisplayUpper(occasion, language) : null]
    .filter(Boolean)
    .join(' · ');
  const showBuy = !teen && hasProducts && post.buyableCount > 0;
  const mine = ownedItemIds(post);
  const buildWithMine = () => {
    track('feed_build_with_mine', { postId: post.id, count: mine.length });
    router.push({ pathname: '/look/new', params: { itemIds: mine.join(','), ...(post.occasion ? { occasion: post.occasion } : {}) } });
  };
  const likes = t('homeFeed.likes', { count: post.likeCount, formatted: formatNumber(post.likeCount) });

  const actions = (
    <View className={`flex-row items-center justify-between ${compact ? 'px-2 pt-1' : '-mx-2'}`}>
      <Toggle
        icon={Heart}
        size={23}
        on={post.liked}
        label={t('homeFeed.like')}
        onPress={() => like(post, !post.liked)}
        testID={`feed.post.${post.id}.like`}
      />
      <Toggle
        icon={Bookmark}
        size={20}
        on={post.saved}
        label={t('homeFeed.save')}
        onPress={() => save(post, !post.saved)}
        testID={`feed.post.${post.id}.save`}
      />
    </View>
  );

  const caption = (
    <Text variant="body" className={`text-[13.5px] leading-[19.5px] ${compact ? 'px-4 pb-4' : '-mt-1.5'}`}>
      <Text variant="bodyMedium" className="text-[13.5px] leading-[19.5px]" accessibilityLiveRegion="polite" testID={`feed.post.${post.id}.likes`}>
        {likes}
      </Text>
      {post.note ? (
        <>
          {'\n'}
          <Text variant="bodyMedium" className="text-[13.5px] leading-[19.5px]">
            {post.author.name}
          </Text>{' '}
          {post.note}
        </>
      ) : null}
    </Text>
  );

  return (
    <View
      className="overflow-hidden rounded-card border border-feed-line bg-paper"
      accessibilityLabel={t('homeFeed.postA11y', { author: post.author.name, title: post.title })}
      testID={`feed.post.${post.id}`}
    >
      <View className="flex-row items-center gap-2.5 py-2.5 pl-3 pr-3">
        <AuthorAvatar author={post.author} />
        <View className="min-w-0 flex-1">
          <View className="flex-row items-center gap-1">
            <Text variant="bodyMedium" numberOfLines={1} className="shrink">
              {post.author.name}
            </Text>
            {post.author.verified ? <VerifiedBadge label={t('homeFeed.verified')} /> : null}
          </View>
          <Text variant="caption" tone="muted" numberOfLines={1} testID={`feed.post.${post.id}.meta`}>
            {meta}
          </Text>
        </View>
      </View>

      <Carousel
        post={post}
        teen={teen}
        height={compact ? COMPACT_IMAGE : FULL_IMAGE}
        overlay={
          compact && post.canTryOn ? (
            <Pressable
              onPress={startTryOn}
              accessibilityRole="button"
              accessibilityLabel={t('homeFeed.tryOnOverlayA11y')}
              testID={`feed.post.${post.id}.tryOn`}
              className="absolute bottom-3 right-3 h-10 flex-row items-center gap-1.5 rounded-pill bg-feed-pill px-3.5 active:opacity-80"
            >
              <Icon icon={Sparkles} size={15} />
              <Text variant="label" className="text-[13px]">
                {t('homeFeed.tryOn')}
              </Text>
            </Pressable>
          ) : undefined
        }
      />

      {compact ? (
        <>
          {actions}
          {tryOn.note ? (
            <Text variant="caption" tone="danger" accessibilityLiveRegion="polite" className="px-4 pb-1">
              {tryOn.note}
            </Text>
          ) : null}
          {caption}
        </>
      ) : (
        <View className="gap-3 px-4 pb-4 pt-[22px]">
          <View>
            <Text variant="eyebrow">{eyebrow}</Text>
            <Text variant="h2" className="mt-1 text-[27px] leading-[28px]">
              {post.title}
            </Text>
          </View>
          {hasProducts ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="-mx-4"
              contentContainerClassName="gap-2 px-4"
              accessibilityLabel={t('homeFeed.piecesA11y')}
            >
              {post.products.map((p) => (
                <PieceChip key={p.id} product={p} teen={teen} />
              ))}
            </ScrollView>
          ) : (
            <FeedPieceStrip postId={post.id} pieces={post.pieces} />
          )}
          {mine.length >= BUILD_WITH_MINE_MIN ? (
            <Pressable
              onPress={buildWithMine}
              accessibilityRole="button"
              accessibilityLabel={t('homeFeed.buildWithMineA11y', { count: mine.length })}
              hitSlop={{ top: 6, bottom: 6 }}
              testID={`feed.post.${post.id}.buildWithMine`}
              className="-my-1 min-h-[36px] flex-row items-center gap-1.5 self-start active:opacity-70"
            >
              <Icon icon={Layers} size={16} tone="accent" />
              <Text variant="label" tone="accent" className="text-[13px]">
                {t('homeFeed.buildWithMine')}
              </Text>
            </Pressable>
          ) : null}
          <View className="flex-row gap-2">
            {post.canTryOn ? (
              <Button
                label={t('homeFeed.tryOn')}
                detail={t('homeFeed.tryOnCost')}
                icon={Sparkles}
                size="bar"
                onPress={startTryOn}
                className="flex-1 px-2.5"
                testID={`feed.post.${post.id}.tryOn`}
              />
            ) : null}
            {showBuy ? (
              <Button
                label={t('homeFeed.buy')}
                variant="secondary"
                icon={ShoppingBag}
                size="bar"
                onPress={() => onBuy(post)}
                accessibilityHint={t('homeFeed.buyA11y', { count: post.buyableCount })}
                className="w-[118px] px-0"
                testID={`feed.post.${post.id}.buy`}
              />
            ) : null}
          </View>
          {tryOn.note ? (
            <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
              {tryOn.note}
            </Text>
          ) : null}
          {actions}
          {caption}
        </View>
      )}
      {tryOn.sheet}
    </View>
  );
}

/**
 * One post of Akış: an editorial post (Droblet Edit, a stylist) or — Akış F2 — a look a member shared, which has its
 * own card (no try-on, no buying; "⋯" and "Benzerlerini gör" instead).
 */
export function FeedPostCard({ post, teen, onBuy, onMenu, onSimilar }: Props) {
  if (post.kind === 'user') return <FeedUserPostCard post={post} teen={teen} onMenu={onMenu} onSimilar={onSimilar} />;
  return <EditorPostCard post={post} teen={teen} onBuy={onBuy} />;
}

/** Content-shaped loading card (canvas n_yukleme): author row, the photo, title and the two buttons as blocks. */
export function FeedPostSkeleton() {
  return (
    <View className="overflow-hidden rounded-card border border-feed-line bg-paper">
      <View className="flex-row items-center gap-2.5 p-3">
        <Skeleton className="h-[34px] w-[34px] rounded-pill" />
        <View className="flex-1 gap-1.5">
          <Skeleton className="h-3 w-2/5 rounded-[5px]" />
          <Skeleton className="h-2.5 w-1/3 rounded-[5px]" />
        </View>
      </View>
      <Skeleton className="h-[410px] w-full rounded-none" />
      <View className="gap-3 px-4 pb-4 pt-[22px]">
        <Skeleton className="h-2.5 w-1/3 rounded-[5px]" />
        <Skeleton className="h-6 w-3/4 rounded-[6px]" />
        <View className="flex-row gap-2">
          <Skeleton className="h-[54px] w-32 rounded-image-lg" />
          <Skeleton className="h-[54px] w-32 rounded-image-lg" />
        </View>
        <View className="flex-row gap-2">
          <View className="flex-1">
            <Skeleton className="h-btn-bar w-full rounded-pill" />
          </View>
          <Skeleton className="h-btn-bar w-[118px] rounded-pill" />
        </View>
      </View>
    </View>
  );
}
