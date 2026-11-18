import { router, useLocalSearchParams } from 'expo-router';
import { Bookmark, Share2, UserPlus } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { linkDomain } from '@/api/config';
import type { FeedLook, FeedStory } from '@/api/contracts/social';
import { Avatar } from '@/components/blocks/basics';
import { StarRating } from '@/components/blocks/rows';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { ListTabBar } from '@/components/navigation/TabBar';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { lookShareUrl } from '@/features/social/feedMath';
import { useFollow, useRateLook, useSaveLook } from '@/features/social/mutations';
import { useFeed, useInviteLink } from '@/features/social/queries';
import { ShareSheet } from '@/features/social/ShareSheet';
import { relativeTime , formatNumber } from '@/lib/format';
import { useThemeColors } from '@/theme/useThemeColors';

function FeedSkeleton() {
  return (
    <View className="gap-5 pt-2">
      <View className="flex-row gap-4 px-gutter">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 w-16 rounded-pill" />
        ))}
      </View>
      <View className="gap-3 px-gutter">
        <Skeleton className="h-11 w-48 rounded-field" />
        <Skeleton className="aspect-[4/5] w-full rounded-image-lg" />
        <Skeleton className="h-11 w-full rounded-field" />
      </View>
    </View>
  );
}

function Stories({ stories }: { stories: FeedStory[] }) {
  const { t } = useTranslation();
  if (stories.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-4 px-gutter pb-2">
      {stories.map((s) => (
        <Pressable
          key={s.handle}
          onPress={() => router.push({ pathname: '/u/[handle]', params: { handle: s.handle } })}
          accessibilityRole="button"
          accessibilityLabel={s.hasNew ? t('feed.storyNew', { name: s.displayName }) : s.displayName}
          className="w-[68px] items-center gap-1.5 active:opacity-80"
        >
          {/* New look = accent ring; the label says so too, colour is not the only signal. */}
          <Avatar name={s.displayName} uri={s.avatarUrl} size={56} ring={s.hasNew ? 'new' : 'seen'} />
          <Text variant="caption" numberOfLines={1}>
            {s.displayName}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function LookPost({ look, onShare }: { look: FeedLook; onShare: () => void }) {
  const { t } = useTranslation();
  const rate = useRateLook();
  const save = useSaveLook();
  const follow = useFollow();
  const { author } = look;

  const when = relativeTime(look.postedAt);
  const time =
    when.unit === 'now'
      ? t('feed.timeNow')
      : when.unit === 'minutes'
        ? t('feed.timeMinutes', { count: when.count })
        : when.unit === 'hours'
          ? t('feed.timeHours', { count: when.count })
          : t('feed.timeDays', { count: when.count });
  const meta = look.occasion ? t('feed.meta', { occasion: t(`occasion.${look.occasion}`), time }) : time;
  const openProfile = () => router.push({ pathname: '/u/[handle]', params: { handle: author.handle } });

  return (
    <View className="gap-3 px-gutter">
      <View className="flex-row items-center gap-3">
        <Pressable
          onPress={openProfile}
          accessibilityRole="button"
          accessibilityLabel={`${author.displayName}, ${meta}`}
          className="min-h-icon-btn flex-1 flex-row items-center gap-3 active:opacity-80"
        >
          <Avatar name={author.displayName} uri={author.avatarUrl} size={40} />
          <View className="flex-1">
            <Text variant="bodyMedium" numberOfLines={1}>
              {author.displayName}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {meta}
            </Text>
          </View>
        </Pressable>
        <Chip
          label={t(author.isFollowing ? 'feed.following' : 'feed.follow')}
          selected={!author.isFollowing}
          onPress={() => follow(author.handle, !author.isFollowing)}
        />
      </View>

      {/* Another person's look is shown with its pieces — never a try-on image. */}
      <PlaceholderImage
        uri={look.imageUrl}
        className="aspect-[4/5] w-full rounded-image-lg"
        accessibilityLabel={t('feed.lookImage', { name: author.displayName })}
      />

      <View className="flex-row items-center justify-between">
        <StarRating value={look.myRating} onRate={(score) => rate(author.handle, look.lookId, score)} />
        <View className="flex-row gap-2">
          <IconButton
            icon={Bookmark}
            active={look.saved}
            onPress={() => save(author.handle, look.lookId, !look.saved)}
            accessibilityLabel={t(look.saved ? 'feed.unsave' : 'feed.save')}
          />
          <IconButton icon={Share2} onPress={onShare} accessibilityLabel={t('feed.share')} />
        </View>
      </View>

      <View className="flex-row flex-wrap items-center gap-x-1">
        <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
          {look.averageRating !== null && look.ratingCount > 0
            ? t('feed.ratingSummary', { average: formatNumber(look.averageRating, { maximumFractionDigits: 1 }), count: look.ratingCount })
            : t('feed.noRatings')}
        </Text>
        <Text variant="caption" tone="muted">
          ·
        </Text>
        <Button variant="text" label={t('feed.viewPieces')} onPress={() => router.push('/shop')} />
      </View>
    </View>
  );
}

/**
 * 25 Arkadaş akışı — story rings (accent = new look), look cards with a 1–5 star rating, save and
 * the share sheet (WhatsApp / Pinterest / link, each carrying the invite code), "Parçaları gör".
 * `?look=` (from a shared link) puts that look first.
 */
export default function FriendsFeedScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { look: linkedLookId } = useLocalSearchParams<{ look?: string }>();
  const feed = useFeed();
  const invite = useInviteLink();
  const [sharing, setSharing] = useState<FeedLook | null>(null);

  const shareUrl = sharing && invite.data ? lookShareUrl(linkDomain(), sharing.lookId, invite.data.code) : null;

  return (
    <Screen>
      <ScreenHeader
        title={t('feed.title')}
        leading="back"
        right={<IconButton icon={UserPlus} onPress={() => router.push('/friends/find')} accessibilityLabel={t('feed.findFriends')} />}
      />
      <ScreenState
        query={feed}
        skeleton={<FeedSkeleton />}
        isEmpty={(data) => data.pages.every((p) => p.items.length === 0)}
        empty={{ message: t('feed.empty'), actionLabel: t('feed.emptyAction'), onAction: () => router.push('/friends/find') }}
      >
        {(data) => {
          const looks = data.pages.flatMap((p) => p.items);
          const ordered = linkedLookId
            ? [...looks.filter((l) => l.lookId === linkedLookId), ...looks.filter((l) => l.lookId !== linkedLookId)]
            : looks;
          return (
            <FlatList
              data={ordered}
              keyExtractor={(item) => item.lookId}
              contentContainerClassName="gap-7 pb-8 pt-2"
              ListHeaderComponent={<Stories stories={data.pages[0]?.stories ?? []} />}
              onEndReachedThreshold={0.6}
              onEndReached={() => {
                if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
              }}
              refreshControl={
                <RefreshControl
                  refreshing={feed.isRefetching && !feed.isFetchingNextPage}
                  onRefresh={() => void feed.refetch()}
                  tintColor={colors.muted}
                />
              }
              renderItem={({ item }) => <LookPost look={item} onShare={() => setSharing(item)} />}
              ListFooterComponent={
                feed.isFetchingNextPage ? (
                  <View className="px-gutter" accessible accessibilityLabel={t('a11y.loading')}>
                    <Skeleton className="aspect-[4/5] w-full rounded-image-lg" />
                  </View>
                ) : undefined
              }
            />
          );
        }}
      </ScreenState>

      <ShareSheet
        visible={sharing !== null}
        onClose={() => setSharing(null)}
        url={shareUrl}
        message={shareUrl ? t('share.lookMessage', { url: shareUrl }) : ''}
        kind="look"
      />
      <ListTabBar owner="discover" />
    </Screen>
  );
}
