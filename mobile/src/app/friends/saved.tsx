import { router } from 'expo-router';
import { BookmarkX } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import type { FeedLook } from '@/api/contracts/social';
import { Card } from '@/components/blocks/basics';
import { IconButton } from '@/components/ui/IconButton';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useSaveLook } from '@/features/social/mutations';
import { useSavedLooks } from '@/features/social/queries';
import { useThemeColors } from '@/theme/useThemeColors';

function SavedSkeleton() {
  return (
    <View className="flex-row gap-3 px-gutter pt-2">
      {[0, 1].map((i) => (
        <View key={i} className="flex-1 gap-2">
          <Skeleton className="aspect-[4/5] w-full rounded-image" />
          <Skeleton className="h-4 w-24 rounded-field" />
        </View>
      ))}
    </View>
  );
}

function SavedCard({ look }: { look: FeedLook }) {
  const { t } = useTranslation();
  const save = useSaveLook();
  const handle = `@${look.author.handle}`;
  const title = look.name || (look.occasion ? t(`occasion.${look.occasion}`) : look.author.displayName);
  return (
    <Card className="flex-1 gap-2 p-2">
      <Pressable
        onPress={() => router.push({ pathname: '/u/[handle]', params: { handle: look.author.handle } })}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${look.author.displayName}`}
        testID={`saved.open.${look.lookId}`}
        className="gap-2 active:opacity-80"
      >
        {/* Another person's look is shown with its piece images — never a try-on image. */}
        <PlaceholderImage uri={look.imageUrl} className="aspect-[4/5] w-full rounded-image" />
        <View className="px-1">
          <Text variant="bodyMedium" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {handle}
          </Text>
        </View>
      </Pressable>
      <View className="absolute right-3 top-3">
        <IconButton
          icon={BookmarkX}
          variant="inverse"
          onPress={() => save(look.author.handle, look.lookId, false)}
          accessibilityLabel={t('friends.unsaveA11y', { name: title })}
          testID={`saved.remove.${look.lookId}`}
        />
      </View>
    </Card>
  );
}

/** Kaydettiğim look'lar (from Profil) — friends' looks I saved; looks no longer visible to me are left out by the server. */
export default function SavedLooksScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const saved = useSavedLooks();

  return (
    <Screen bottom>
      <ScreenHeader title={t('friends.savedTitle')} leading="back" />
      <ScreenState
        query={saved}
        skeleton={<SavedSkeleton />}
        isEmpty={(list) => list.length === 0}
        empty={{ message: t('friends.savedEmpty'), actionLabel: t('friends.savedEmptyAction'), onAction: () => router.push('/friends/feed') }}
      >
        {(list) => (
          <FlatList
            data={list}
            numColumns={2}
            keyExtractor={(l) => l.lookId}
            columnWrapperClassName="gap-3 px-gutter"
            contentContainerClassName="gap-3 pb-8 pt-2"
            refreshControl={<RefreshControl refreshing={saved.isRefetching} onRefresh={() => void saved.refetch()} tintColor={colors.muted} />}
            renderItem={({ item }) => <SavedCard look={item} />}
          />
        )}
      </ScreenState>
    </Screen>
  );
}
