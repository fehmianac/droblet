import { router, useLocalSearchParams } from 'expo-router';
import { Bookmark, ChevronLeft, CirclePlus, Ellipsis, Heart, Layers, Search, ShoppingBag, Sparkles } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import type { FeedPost } from '@/api/contracts/feed';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { BuySheet } from '@/features/feed/BuySheet';
import { AuthorAvatar, FeedLink, FeedToggle, VerifiedBadge } from '@/features/feed/FeedBits';
import { FeedCarousel } from '@/features/feed/FeedCarousel';
import { FeedPostPieces } from '@/features/feed/FeedPostPieces';
import { BUILD_WITH_MINE_MIN, isHiddenThisSession, ownedItemIds, postMeta } from '@/features/feed/logic';
import { openBuildWithMine, useLikeFeedPost, useSaveFeedPost } from '@/features/feed/mutations';
import { useFeedPost, useFeedPostRead } from '@/features/feed/queries';
import { SaveAsLookSheet } from '@/features/feed/SaveAsLookSheet';
import { useFeedTryOn } from '@/features/feed/useFeedTryOn';
import { useUserPostSheets } from '@/features/feed/useUserPostSheets';
import { useTeenRules } from '@/features/teen/store';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { formatNumber } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';
import { spacing } from '@/theme/tokens';

/** Height of the photograph: the hero of the look detail (14b). */
const PHOTO = 420;

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

function PostDetail({ post }: { post: FeedPost }) {
  const { t } = useTranslation();
  const language = useAppLanguage();
  const { width: windowWidth } = useWindowDimensions();
  // Teen account: no prices, no buying, no "Benzerlerini gör"; products do not open the store (canvas 18).
  const teen = useTeenRules().hide.commerce;
  const like = useLikeFeedPost();
  const save = useSaveFeedPost();
  const tryOn = useFeedTryOn(post);
  const userPost = useUserPostSheets({ teen });
  const [lookSheet, setLookSheet] = useState(false);
  const [buying, setBuying] = useState(false);

  const user = post.kind === 'user';
  const author = post.author.name;
  const handle = post.author.handle;
  const hasProducts = post.products.length > 0;
  const mine = ownedItemIds(post);
  // The same offers as on the card: each only where the card has it.
  const showBuildWithMine = !user && mine.length >= BUILD_WITH_MINE_MIN;
  const showAddToLooks = !user && post.pieces.length > 0;
  const showBuy = !user && !teen && hasProducts && post.buyableCount > 0;
  const showSimilar = user && post.hasSimilar && !teen;
  const several = post.images.length > 1;
  const likes = t('homeFeed.likes', { count: post.likeCount, formatted: formatNumber(post.likeCount) });

  const who = (
    <>
      <AuthorAvatar author={post.author} size={32} />
      <View className="min-w-0 shrink flex-row items-center gap-1">
        <Text variant="bodyMedium" numberOfLines={1} className="shrink">
          {author}
        </Text>
        {post.author.verified ? <VerifiedBadge label={t('homeFeed.verified')} /> : null}
      </View>
    </>
  );

  return (
    <Screen>
      <View className="h-12 flex-row items-center gap-0.5 px-gutter" testID="feed.detail">
        <IconButton icon={ChevronLeft} variant="plain" iconSize={22} onPress={leave} accessibilityLabel={t('a11y.back')} className="-ml-2.5" testID="feed.detail.back" />
        {user && handle ? (
          <Pressable
            onPress={() => router.push({ pathname: '/u/[handle]', params: { handle } })}
            accessibilityRole="link"
            accessibilityLabel={t('homeFeed.openProfileA11y', { author })}
            testID="feed.detail.author"
            className="min-h-icon-btn min-w-0 flex-1 flex-row items-center gap-2.5 active:opacity-70"
          >
            {who}
          </Pressable>
        ) : (
          <View className="min-h-icon-btn min-w-0 flex-1 flex-row items-center gap-2.5" accessible accessibilityLabel={author} testID="feed.detail.author">
            {who}
          </View>
        )}
        {user ? (
          <IconButton icon={Ellipsis} iconSize={20} variant="plain" onPress={() => userPost.openMenu(post)} accessibilityLabel={t('homeFeed.postMenuA11y')} className="-mr-2.5" testID="feed.detail.menu" />
        ) : null}
      </View>

      <ScrollView contentContainerClassName="gap-4 px-gutter pb-8 pt-1" testID="feed.detail.scroll">
        {/* The dots of several photographs sit 14 under the frame. */}
        <View className={several ? 'mb-3' : ''}>
          <FeedCarousel
            post={post}
            // 20 in from each edge, inside the frame's 1 pt hairline.
            width={Math.max(1, windowWidth - spacing.gutter * 2 - 2)}
            height={PHOTO}
            zoom
            frameClassName="rounded-card border border-line"
            testIDPrefix="feed.detail"
          />
        </View>

        <View className="gap-1">
          <Text variant="eyebrow" testID="feed.detail.eyebrow">
            {toDisplayUpper(postMeta(t, post), language)}
          </Text>
          <Text variant="h2" testID="feed.detail.title">
            {post.title}
          </Text>
          {post.note ? (
            <Text variant="body" className="mt-1" testID="feed.detail.note">
              {post.note}
            </Text>
          ) : null}
        </View>

        <FeedPostPieces post={post} teen={teen} />

        {showBuildWithMine || showAddToLooks || showBuy || showSimilar ? (
          <View className="gap-2">
            {showBuildWithMine ? (
              <FeedLink
                icon={Layers}
                label={t('homeFeed.buildWithMine')}
                accessibilityLabel={t('homeFeed.buildWithMineA11y', { count: mine.length })}
                onPress={() => openBuildWithMine(post)}
                testID="feed.detail.buildWithMine"
              />
            ) : null}
            {showAddToLooks ? (
              <FeedLink icon={CirclePlus} label={t('homeFeed.addToLooks')} accessibilityLabel={t('homeFeed.addToLooksA11y')} onPress={() => setLookSheet(true)} testID="feed.detail.addToLooks" />
            ) : null}
            {showBuy ? (
              <Button
                label={t('homeFeed.buy')}
                variant="secondary"
                icon={ShoppingBag}
                size="bar"
                onPress={() => setBuying(true)}
                accessibilityHint={t('homeFeed.buyA11y', { count: post.buyableCount })}
                className="mt-1"
                testID="feed.detail.buy"
              />
            ) : null}
            {showSimilar ? (
              <Button label={t('homeFeed.similar')} variant="secondary" icon={Search} size="bar" onPress={() => userPost.openSimilar(post)} className="mt-1" testID="feed.detail.similar" />
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <BottomActionBar>
        <View className="-ml-2 flex-row items-center">
          <FeedToggle icon={Heart} size={23} on={post.liked} label={t('homeFeed.like')} onPress={() => like(post, !post.liked)} testID="feed.detail.like" />
          <Text variant="bodyMedium" accessibilityLabel={likes} accessibilityLiveRegion="polite" className="min-w-[22px]" testID="feed.detail.likes">
            {formatNumber(post.likeCount)}
          </Text>
          {post.canTryOn ? null : <View className="flex-1" />}
          <FeedToggle icon={Bookmark} size={20} on={post.saved} label={t('homeFeed.save')} onPress={() => save(post, !post.saved)} testID="feed.detail.save" />
          {post.canTryOn ? (
            <View className="ml-1.5 flex-1">
              <Button label={t('homeFeed.tryOn')} detail={t('homeFeed.tryOnCost')} icon={Sparkles} size="bar" onPress={tryOn.start} className="px-2.5" testID="feed.detail.tryOn" />
            </View>
          ) : null}
        </View>
        {tryOn.note ? (
          <Text variant="caption" tone="danger" accessibilityLiveRegion="polite" className="mt-1.5" testID="feed.detail.tryOnNote">
            {tryOn.note}
          </Text>
        ) : null}
      </BottomActionBar>

      {tryOn.sheet}
      {lookSheet ? <SaveAsLookSheet post={post} onClose={() => setLookSheet(false)} /> : null}
      {teen ? null : <BuySheet post={buying ? post : null} onClose={() => setBuying(false)} />}
      {userPost.sheets}
    </Screen>
  );
}

/**
 * A post of Akış, opened from its card (owner request 2026-11-23: "tap a look on the home feed, open its detail and
 * see its pieces") — derived from the look detail (14b) and the feed cards (06″ / 06‴): the author in the header (and
 * "⋯" on a member's look), the photograph(s) large (a tap opens the full-screen viewer), "OFİS · SONBAHAR · 3 SA" over
 * the title and the note, "Parçalar · N" (the pieces as a two-column grid, or the products as rows), the card's other
 * offers under it, and a bottom bar with ♡ and its count, Kaydet and "Üzerimde dene · 1 kredi".
 *
 * There is no "get one post" read: the post comes from the cache (the loaded pages of Akış, the saved list, the copy
 * kept when the card was tapped) and is followed live, so a like here shows on the card and the other way round.
 * Opened without it (cold), the screen says so and leads back to Akış. A post hidden or reported from here closes it.
 */
export default function FeedPostScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const post = useFeedPost(id);
  // "Bunu gösterme" / "Şikâyet et" took the post out of every list: nothing left to show here.
  const hidden = !post && Boolean(id) && isHiddenThisSession(id);
  // Opened cold (a link, a restart on this screen): no list holds the post, so it is read by its id.
  const read = useFeedPostRead(id, !post && !hidden);
  useEffect(() => {
    if (hidden) leave();
  }, [hidden]);

  if (post) return <PostDetail post={post} />;
  return (
    <Screen bottom>
      <ScreenHeader leading="back" onLeadingPress={leave} />
      {hidden ? null : (
        <ScreenState
          query={read}
          loadingLabel={t('homeFeed.detail.loading')}
          notFound={{ message: t('homeFeed.detail.notFound'), actionLabel: t('homeFeed.detail.backToFeed'), onAction: () => router.replace('/') }}
        >
          {() => null}
        </ScreenState>
      )}
    </Screen>
  );
}
