import { router, useLocalSearchParams } from 'expo-router';
import { Bookmark, Share, Users } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { linkDomain } from '@/api/config';
import type { FeedLook, FeedStory } from '@/api/contracts/social';
import { Avatar } from '@/components/blocks/basics';
import { StarRating } from '@/components/blocks/rows';
import { ListTabBar } from '@/components/navigation/TabBar';
import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { lookShareUrl } from '@/features/social/feedMath';
import { useFollow, useRateLook, useSaveLook } from '@/features/social/mutations';
import { Notice, useNotice } from '@/features/social/Notice';
import { useFeed, useInviteLink } from '@/features/social/queries';
import { ShareSheet } from '@/features/social/ShareSheet';
import { formatNumber, relativeTime } from '@/lib/format';
import { useThemeColors } from '@/theme/useThemeColors';

function FeedSkeleton() {
  return (
    <View className="gap-3 pt-1">
      <View className="flex-row gap-3.5 px-gutter">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[58px] w-[58px] rounded-pill" />
        ))}
      </View>
      <View className="gap-2.5 px-gutter">
        <Skeleton className="h-9 w-48 rounded-field" />
        <Skeleton className="h-[290px] w-full rounded-tile" />
        <Skeleton className="h-11 w-full rounded-field" />
      </View>
    </View>
  );
}

/** Story row: 58 rings, 14 apart, the first name under each (accent ring = a new look). */
function Stories({ stories }: { stories: FeedStory[] }) {
  const { t } = useTranslation();
  if (stories.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3.5 px-gutter pb-3">
      {stories.map((s) => (
        <Pressable
          key={s.handle}
          onPress={() => router.push({ pathname: '/u/[handle]', params: { handle: s.handle } })}
          accessibilityRole="button"
          accessibilityLabel={s.hasNew ? t('feed.storyNew', { name: s.displayName }) : s.displayName}
          className="w-[62px] items-center gap-[5px] active:opacity-80"
        >
          {/* New look = accent ring; the label says so too, colour is not the only signal. */}
          <Avatar name={s.displayName} uri={s.avatarUrl} size={50} ring={s.hasNew ? 'new' : 'seen'} />
          <Text variant="caption" numberOfLines={1} className="text-[11px] leading-[14px]">
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
  const rated = look.averageRating !== null && look.ratingCount > 0;

  return (
    <View className="gap-2.5 px-gutter">
      <View className="flex-row items-center gap-2.5">
        <Pressable
          onPress={openProfile}
          accessibilityRole="button"
          accessibilityLabel={`${author.displayName}, ${meta}`}
          className="min-h-icon-btn flex-1 flex-row items-center gap-2.5 active:opacity-80"
        >
          <Avatar name={author.displayName} uri={author.avatarUrl} size={36} />
          <View className="flex-1">
            <Text variant="bodyMedium" numberOfLines={1}>
              {author.displayName}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {meta}
            </Text>
          </View>
        </Pressable>
        {/* Outlined in both states, as drawn; the text carries the state. */}
        <Chip
          label={t(author.isFollowing ? 'feed.following' : 'feed.follow')}
          accessibilityHint={t(author.isFollowing ? 'feed.unfollowHint' : 'feed.followHint', { name: author.displayName })}
          onPress={() => follow(author.handle, !author.isFollowing)}
        />
      </View>

      {/* Another person's look is shown with its pieces — never a try-on image. */}
      <ImageSlot
        uri={look.imageUrl}
        className="h-[290px] w-full rounded-tile"
        accessibilityLabel={t('feed.lookImage', { name: author.displayName })}
        placeholder={{ kind: 'look', pieces: look.pieces ?? [], seed: look.lookId, figureHeight: 184 }}
      />

      <View className="flex-row items-center justify-between">
        <StarRating value={look.myRating} onRate={(score) => rate(author.handle, look.lookId, score)} />
        <View className="flex-row">
          <IconButton
            icon={Bookmark}
            variant="plain"
            iconSize={21}
            active={look.saved}
            onPress={() => save(author.handle, look.lookId, !look.saved)}
            accessibilityLabel={t(look.saved ? 'feed.unsave' : 'feed.save')}
          />
          <IconButton icon={Share} variant="plain" onPress={onShare} accessibilityLabel={t('feed.share')} />
        </View>
      </View>

      <View className="flex-row flex-wrap items-center">
        <Text variant="caption" accessibilityLiveRegion="polite">
          {rated ? (
            <>
              <Text variant="label">{formatNumber(look.averageRating ?? 0, { maximumFractionDigits: 1 })}</Text>
              {` ${t('feed.ratingRest', { count: look.ratingCount })}`}
            </>
          ) : (
            t('feed.noRatings')
          )}
          {' · '}
        </Text>
        <Pressable
          onPress={() => router.push('/shop')}
          accessibilityRole="link"
          accessibilityLabel={t('feed.viewPieces')}
          hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }}
          className="active:opacity-70"
        >
          <Text variant="label" className="underline">
            {t('feed.viewPieces')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * 25 Arkadaş akışı — story rings (accent = new look), look cards with a 1–5 star rating, save and
 * the share sheet (WhatsApp / Pinterest / "Link kopyala", each carrying the invite code), "Parçaları gör".
 * `?look=` (from a shared link) puts that look first.
 */
export default function FriendsFeedScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { look: linkedLookId } = useLocalSearchParams<{ look?: string }>();
  const feed = useFeed();
  const invite = useInviteLink();
  const [sharing, setSharing] = useState<FeedLook | null>(null);
  const { notice, show } = useNotice();

  const shareUrl = sharing && invite.data ? lookShareUrl(linkDomain(), sharing.lookId, invite.data.code) : null;

  return (
    <Screen>
      <ScreenHeader
        title={t('feed.title')}
        leading="back"
        right={<IconButton icon={Users} onPress={() => router.push('/friends/find')} accessibilityLabel={t('feed.findFriends')} />}
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
              contentContainerClassName="pb-8 pt-1"
              ListHeaderComponent={<Stories stories={data.pages[0]?.stories ?? []} />}
              ItemSeparatorComponent={PostGap}
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
                  <View className="px-gutter pt-7" accessible accessibilityLabel={t('a11y.loading')}>
                    <Skeleton className="h-[290px] w-full rounded-tile" />
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
        target={sharing ? { targetKind: 'look', targetId: sharing.lookId, ownerHandle: sharing.author.handle } : undefined}
        onCopied={show}
      />
      <Notice notice={notice} />
      <ListTabBar owner="discover" />
    </Screen>
  );
}

function PostGap() {
  return <View className="h-7" />;
}
