import { router } from 'expo-router';
import { Bell, CalendarCheck } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { track } from '@/analytics/track';
import { FEED_TABS, type EditorStory, type FeedPost, type FeedTab } from '@/api/contracts/feed';
import { useToday, useWearToday } from '@/api/today';
import { Logo } from '@/components/brand/Logo';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { ScreenState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { BuySheet } from '@/features/feed/BuySheet';
import { FeedPostCard, FeedPostSkeleton } from '@/features/feed/FeedPostCard';
import { FirstStepCard, useHasTriedOn } from '@/features/feed/FirstStepCard';
import { firstViewThisSession, isEditFallback, isHiddenThisSession } from '@/features/feed/logic';
import { useEditorStories, useFeedPosts } from '@/features/feed/queries';
import { StoriesRow } from '@/features/feed/StoriesRow';
import { TodayEmptyRow, TodayQuickCard } from '@/features/feed/TodayQuickCard';
import { useUserPostSheets } from '@/features/feed/useUserPostSheets';
import { storySeenStore, useSeenStories } from '@/features/feed/storySeen';
import { useUnreadNotificationCount } from '@/features/notifications/queries';
import { PlanLookSheet } from '@/features/today/PlanLookSheet';
import { useTeenRules } from '@/features/teen/store';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { formatDate, formatTemperature } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';
import { useThemeColors } from '@/theme/useThemeColors';

/** "ÇARŞAMBA 18 KASIM · 14° İSTANBUL · PARÇALI BULUTLU": the date always; the weather only when it is known. */
function useEyebrow(): string {
  const { t } = useTranslation();
  const language = useAppLanguage();
  const today = useToday();
  const now = new Date();
  const parts = [t('homeFeed.date', { weekday: formatDate(now, { weekday: 'long' }), day: formatDate(now, { day: 'numeric' }), month: formatDate(now, { month: 'long' }) })];
  const weather = today.data?.weather;
  if (weather) {
    parts.push([formatTemperature(weather.temperatureC), weather.city].filter(Boolean).join(' '));
    if (weather.condition && weather.condition !== 'unknown') {
      const condition = t(`weatherCondition.${weather.condition}`, { defaultValue: '' });
      if (condition) parts.push(condition);
    }
  }
  return toDisplayUpper(parts.join(' · '), language);
}

/** "Senin için" filter: four equal tabs on a hairline, the selected one ink + medium with a 2 pt underline. */
function FeedTabs({ value, onChange }: { value: FeedTab; onChange: (tab: FeedTab) => void }) {
  const { t } = useTranslation();
  return (
    <View accessibilityRole="tablist" accessibilityLabel={t('homeFeed.filterA11y')} className="mx-gutter flex-row border-b border-line">
      {FEED_TABS.map((tab) => {
        const selected = tab === value;
        return (
          <Pressable
            key={tab}
            onPress={() => onChange(tab)}
            accessibilityRole="tab"
            accessibilityLabel={t(`homeFeed.tabs.${tab}`)}
            accessibilityState={{ selected }}
            testID={`feed.tab.${tab}`}
            className={`-mb-px h-11 flex-1 items-center justify-center border-b-2 ${selected ? 'border-ink' : 'border-transparent'}`}
          >
            <Text variant={selected ? 'bodyMedium' : 'body'} tone={selected ? 'ink' : 'muted'} numberOfLines={1}>
              {t(`homeFeed.tabs.${tab}`)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** FlatList needs both to stay the same object for the list's life: module constants. */
const VIEWABILITY = { itemVisiblePercentThreshold: 50 };
/** `feed_post_view`: once per post per app session, when half of the card is on screen. */
function onViewable({ viewableItems }: { viewableItems: { item: FeedPost | null | undefined }[] }) {
  for (const token of viewableItems) {
    const post = token.item;
    if (post && firstViewThisSession(post.id)) track('feed_post_view', { postId: post.id, authorKind: post.author.kind });
  }
}

function PostGap() {
  return <View className="h-8" />;
}

/**
 * Akış F1 — the first tab (canvas 06″, decisions 16–19): logo, the calendar (→ 06 Bugün) and the bell; the date and
 * weather over "Bugün ne giysem?"; the story row ("Bugün" first, then the editor stories); "İlk look'unu dene" until
 * the first try-on; "Senin için" with Tümü · Ofis · Hafta sonu · Davet; editorial posts (paged, pull to refresh)
 * ending with "Hepsi bu kadar. Yarın sabah yeni öneriler." Teen accounts see everything except prices and buying.
 *
 * Akış F2 (canvas 06‴, decision 21): looks members shared sit between the editor posts with their own card — "⋯"
 * (Bunu gösterme · Şikâyet et) and "Benzerlerini gör" open sheets owned here. The server never sends them to teens.
 */
export default function FeedScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const teen = useTeenRules().hide.commerce;
  const eyebrow = useEyebrow();
  const [tab, setTab] = useState<FeedTab>('all');
  const posts = useFeedPosts(tab);
  const stories = useEditorStories();
  const today = useToday();
  const wear = useWearToday();
  const unread = useUnreadNotificationCount();
  const seen = useSeenStories();
  const triedOn = useHasTriedOn();
  const [buying, setBuying] = useState<FeedPost | null>(null);
  const userPost = useUserPostSheets({ teen });
  // 07c "Bu güne look seç" for today, opened from the "Bugün için plan yok" row.
  const [planDate, setPlanDate] = useState<string | null>(null);
  const listRef = useRef<FlatList<FeedPost>>(null);

  // A post can move to the next page while paging (a new one was published): it is shown once.
  const items: FeedPost[] = [];
  const ids = new Set<string>();
  for (const post of posts.data?.pages.flatMap((p) => p.items) ?? []) {
    // Hidden or reported in this session: stays out even if a refetch brings it back.
    if (ids.has(post.id) || isHiddenThisSession(post.id)) continue;
    ids.add(post.id);
    items.push(post);
  }
  // The open sheet follows the cached post (a like elsewhere, a refetch).
  const buyingPost = buying ? (items.find((p) => p.id === buying.id) ?? buying) : null;


  const openStory = (story: EditorStory) => {
    void storySeenStore.markSeen(story.id);
    router.push({ pathname: '/feed/story', params: { id: story.id } });
  };

  const refresh = () => {
    void posts.refetch();
    void stories.refetch();
    void today.refetch();
  };

  const todayLook = today.data?.look ?? null;
  const editFallback = tab === 'all' && isEditFallback(items);

  const header = (
    <View className="pb-4">
      <View className="gap-1.5 px-gutter pt-1.5">
        <Text variant="eyebrow" testID="feed.eyebrow">
          {eyebrow}
        </Text>
        <Text variant="display" accessibilityRole="header" className="text-[40px] leading-[41px]">
          {t('homeFeed.title')}
        </Text>
      </View>
      <View className="mt-4">
        <StoriesRow
          today={today.data}
          stories={stories.data}
          storiesLoading={stories.isPending}
          seen={seen}
          onOpenToday={() => router.push('/today')}
          onOpenStory={openStory}
        />
      </View>
      {/* Today's planned look stays one tap from "Bunu giyiyorum" now that Bugün is a screen away. */}
      {todayLook ? (
        <View className="px-gutter pt-[18px]">
          <TodayQuickCard look={todayLook} onOpen={() => router.push('/today')} onWear={() => wear.wear(todayLook.id)} />
        </View>
      ) : today.data ? (
        // No look today: the same quiet row offers one of the saved looks (07c), without leaving Akış.
        <View className="px-gutter pt-[18px]">
          <TodayEmptyRow onOpen={() => router.push('/today')} onPick={() => setPlanDate(today.data.date)} />
        </View>
      ) : null}
      {triedOn === false ? (
        <View className="px-gutter pt-[18px]">
          <FirstStepCard
            imageUrl={items[0]?.images[0] ?? null}
            pieces={(items[0]?.products ?? []).map((p) => ({ category: p.category, color: p.colors[0], imageUrl: p.imageUrl }))}
            onPress={() => {
              if (items.length > 0) listRef.current?.scrollToIndex({ index: 0, viewOffset: 12, animated: true });
            }}
          />
        </View>
      ) : null}
      <View className="mt-[26px] gap-3.5">
        <View className="flex-row items-end justify-between px-gutter">
          <Text variant="h2" className="text-[30px] leading-[30px]">
            {t('homeFeed.forYou')}
          </Text>
          <Text variant="caption" tone="muted">
            {t('homeFeed.forYouNote')}
          </Text>
        </View>
        {/* Only the weekly edit to show: its looks have no occasion, so the tabs would be empty — left out. */}
        {editFallback ? <View className="mx-gutter border-b border-line" /> : <FeedTabs value={tab} onChange={setTab} />}
      </View>
    </View>
  );

  const footer = posts.isFetchingNextPage ? (
    <View className="px-gutter pt-8" accessible accessibilityLabel={t('homeFeed.loadingMore')}>
      <FeedPostSkeleton />
    </View>
  ) : items.length > 0 && !posts.hasNextPage ? (
    <Text variant="caption" tone="muted" className="mt-[22px] px-gutter text-center" testID="feed.end">
      {t('homeFeed.endText')}
    </Text>
  ) : undefined;

  return (
    <Screen>
      <View className="h-12 flex-row items-center justify-between px-gutter">
        <Logo />
        <View className="flex-row gap-2">
          <IconButton icon={CalendarCheck} iconSize={20} onPress={() => router.push('/today')} accessibilityLabel={t('homeFeed.planA11y')} testID="feed.plan" />
          <View>
            <IconButton
              icon={Bell}
              iconSize={20}
              onPress={() => router.push('/notifications')}
              accessibilityLabel={unread > 0 ? t('notifCenter.bellUnread', { count: unread }) : t('todayHome.notifications')}
              testID="feed.bell"
            />
            {unread > 0 ? (
              // Unread dot (accent, cream ring) on the bell's corner; the count is in the label for screen readers.
              <View pointerEvents="none" accessible={false} testID="bell-badge" className="absolute right-2.5 top-[9px] h-2 w-2 rounded-pill border-[1.5px] border-cream bg-accent" />
            ) : null}
          </View>
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(post) => post.id}
        accessibilityLabel={t('homeFeed.listA11y')}
        testID="feed.list"
        contentContainerClassName="pb-8"
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <View className="px-gutter">
            <FeedPostCard post={item} teen={teen} onBuy={setBuying} onMenu={userPost.openMenu} onSimilar={userPost.openSimilar} />
          </View>
        )}
        ItemSeparatorComponent={PostGap}
        ListEmptyComponent={
          <View className="min-h-[420px]">
            <ScreenState
              query={posts}
              isEmpty={() => true}
              empty={
                tab === 'all'
                  ? { message: t('homeFeed.emptyAll'), actionLabel: t('homeFeed.emptyAllAction'), onAction: () => router.push('/today') }
                  : { message: t('homeFeed.empty'), actionLabel: t('homeFeed.emptyAction'), onAction: () => setTab('all') }
              }
              error={{ title: t('homeFeed.errorTitle') }}
              loadingLabel={t('homeFeed.loading')}
              skeleton={
                <View className="px-gutter">
                  <FeedPostSkeleton />
                </View>
              }
            >
              {() => null}
            </ScreenState>
          </View>
        }
        ListFooterComponent={footer}
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (posts.hasNextPage && !posts.isFetchingNextPage) void posts.fetchNextPage();
        }}
        onScrollToIndexFailed={() => undefined}
        viewabilityConfig={VIEWABILITY}
        onViewableItemsChanged={onViewable}
        refreshControl={<RefreshControl refreshing={posts.isRefetching && !posts.isFetchingNextPage} onRefresh={refresh} tintColor={colors.muted} />}
      />

      {teen ? null : <BuySheet post={buyingPost} onClose={() => setBuying(null)} />}
      {userPost.sheets}
      <PlanLookSheet
        date={planDate}
        occasion={today.data && planDate === today.data.date ? today.data.occasion : null}
        onClose={() => setPlanDate(null)}
        onSuggest={() => {
          const date = planDate;
          setPlanDate(null);
          if (date) router.navigate({ pathname: '/stylist', params: { date } });
        }}
      />
    </Screen>
  );
}

/** A render error in this tab shows the error state with "Tekrar dene"; the tab bar and the other tabs keep working. */
export { ScreenErrorBoundary as ErrorBoundary } from '@/components/ScreenErrorBoundary';
