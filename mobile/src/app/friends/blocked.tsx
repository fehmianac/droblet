import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, View } from 'react-native';

import { Avatar } from '@/components/blocks/basics';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { useUnblockPerson } from '@/features/social/mutations';
import { RowAction } from '@/features/social/PeopleRows';
import { useBlockedPeople } from '@/features/social/queries';
import { useThemeColors } from '@/theme/useThemeColors';

/**
 * Engellenen hesaplar (from Ayarlar) — only handle and name, as the server returns them; a blocked
 * profile cannot be opened, so the rows are not links. Unblocking does not restore follows.
 */
export default function BlockedAccountsScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const blocked = useBlockedPeople();
  const unblock = useUnblockPerson();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/settings'));

  return (
    <Screen bottom>
      <ScreenHeader title={t('friends.blockedTitle')} leading="back" />
      <ScreenState
        query={blocked}
        isEmpty={(list) => list.length === 0}
        empty={{
          message: t('friends.blockedEmpty'),
          actionLabel: t('friends.blockedEmptyAction'),
          onAction: back,
        }}
      >
        {(list) => (
          <FlatList
            data={list}
            keyExtractor={(p) => p.handle}
            contentContainerClassName="gap-3 pb-8 pt-2"
            ListHeaderComponent={
              <Text variant="caption" tone="muted" className="px-gutter pb-1">
                {t('friends.blockedNote')}
              </Text>
            }
            refreshControl={
              <RefreshControl refreshing={blocked.isRefetching} onRefresh={() => void blocked.refetch()} tintColor={colors.muted} />
            }
            renderItem={({ item }) => {
              const handle = `@${item.handle}`;
              return (
                <View className="min-h-14 flex-row items-center gap-3 px-gutter">
                  <Avatar name={item.displayName} uri={item.avatarUrl} size={44} />
                  <View className="flex-1">
                    <Text variant="bodyMedium" numberOfLines={1}>
                      {item.displayName}
                    </Text>
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {handle}
                    </Text>
                  </View>
                  <RowAction
                    label={t('friends.unblock')}
                    hint={t('friends.unblockA11y', { name: item.displayName })}
                    onPress={() => unblock(item.handle)}
                    testID={`blocked.unblock.${item.handle}`}
                  />
                </View>
              );
            }}
          />
        )}
      </ScreenState>
    </Screen>
  );
}
