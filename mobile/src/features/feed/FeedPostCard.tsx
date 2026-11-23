import { router } from 'expo-router';
import { Bookmark, CirclePlus, Heart, Layers, ShoppingBag, Sparkles } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import type { FeedPost, FeedProduct } from '@/api/contracts/feed';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { formatMoney, formatNumber } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';
import { feedTones, spacing } from '@/theme/tokens';

import { AuthorAvatar, FeedLink, FeedToggle, VerifiedBadge } from './FeedBits';
import { FeedCarousel } from './FeedCarousel';
import { FeedPieceStrip } from './FeedPieceStrip';
import { FeedUserPostCard } from './FeedUserPostCard';
import { BUILD_WITH_MINE_MIN, occasionLabel, ownedItemIds, postMeta } from './logic';
import { openBuildWithMine, useLikeFeedPost, useOpenFeedPost, useSaveFeedPost } from './mutations';
import { SaveAsLookSheet } from './SaveAsLookSheet';
import { useFeedTryOn } from './useFeedTryOn';

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
 *
 * "Looklarıma ekle" (owner decision 2026-11-23; a post with pieces): the same kind of accent link under the strip. It
 * opens the sheet with the two ways of saving the post into the member's own looks — as inspiration, or with its
 * pieces (`SaveAsLookSheet`). ♡ and the bookmark stay as they are.
 *
 * A tap on a photograph or on the title opens the post's detail (`feed/[id]`, owner request 2026-11-23): the pieces
 * large, the photograph in the full-screen viewer. Everything else on the card keeps its own tap.
 */
function EditorPostCard({ post, teen, onBuy }: Pick<Props, 'post' | 'teen' | 'onBuy'>) {
  const { t } = useTranslation();
  const language = useAppLanguage();
  const like = useLikeFeedPost();
  const save = useSaveFeedPost();
  const tryOn = useFeedTryOn(post);
  const startTryOn = tryOn.start;
  const openPost = useOpenFeedPost();
  const open = () => openPost(post);
  const openLabel = t('homeFeed.openPostA11y', { title: post.title });
  const { width: windowWidth } = useWindowDimensions();
  // The card sits 20 in from each edge and has a 1 pt hairline.
  const width = Math.max(1, windowWidth - spacing.gutter * 2 - 2);

  const hasProducts = post.products.length > 0;
  const compact = !hasProducts && post.pieces.length === 0;
  const meta = postMeta(t, post);
  const occasion = occasionLabel(t, post.occasion);
  const eyebrow = [t(post.author.kind === 'edit' ? 'homeFeed.eyebrowEdit' : 'homeFeed.eyebrowStylist'), occasion ? toDisplayUpper(occasion, language) : null]
    .filter(Boolean)
    .join(' · ');
  const showBuy = !teen && hasProducts && post.buyableCount > 0;
  const mine = ownedItemIds(post);
  const buildWithMine = () => openBuildWithMine(post);
  const likes = t('homeFeed.likes', { count: post.likeCount, formatted: formatNumber(post.likeCount) });
  const [lookSheet, setLookSheet] = useState(false);

  const actions = (
    <View className={`flex-row items-center justify-between ${compact ? 'px-2 pt-1' : '-mx-2'}`}>
      <FeedToggle
        icon={Heart}
        size={23}
        on={post.liked}
        label={t('homeFeed.like')}
        onPress={() => like(post, !post.liked)}
        testID={`feed.post.${post.id}.like`}
      />
      <FeedToggle
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

      <FeedCarousel
        post={post}
        width={width}
        height={compact ? COMPACT_IMAGE : FULL_IMAGE}
        buyable={!teen}
        onPress={open}
        pressLabel={openLabel}
        testIDPrefix={`feed.post.${post.id}`}
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
            <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={openLabel} testID={`feed.post.${post.id}.title`} className="active:opacity-70">
              <Text variant="h2" accessibilityRole="none" className="mt-1 text-[27px] leading-[28px]">
                {post.title}
              </Text>
            </Pressable>
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
            <FeedLink
              icon={Layers}
              label={t('homeFeed.buildWithMine')}
              accessibilityLabel={t('homeFeed.buildWithMineA11y', { count: mine.length })}
              onPress={buildWithMine}
              testID={`feed.post.${post.id}.buildWithMine`}
              className="-my-1"
            />
          ) : null}
          {post.pieces.length > 0 ? (
            <FeedLink
              icon={CirclePlus}
              label={t('homeFeed.addToLooks')}
              accessibilityLabel={t('homeFeed.addToLooksA11y')}
              onPress={() => setLookSheet(true)}
              testID={`feed.post.${post.id}.addToLooks`}
              className="-my-1"
            />
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
      {lookSheet ? <SaveAsLookSheet post={post} onClose={() => setLookSheet(false)} /> : null}
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
