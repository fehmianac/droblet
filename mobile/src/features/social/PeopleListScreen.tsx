import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, View } from 'react-native';

import type { PersonSuggestion } from '@/api/contracts/social';
import { DangerButton } from '@/components/blocks/basics';
import { ConfirmDialog } from '@/components/blocks/rows';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { useThemeColors } from '@/theme/useThemeColors';

import { useRemoveFollower } from './mutations';
import { FollowChip, PersonListRow, RowAction } from './PeopleRows';
import { useFollowers, useFollowing } from './queries';

/**
 * Takipçiler / Takip edilenler (from the Profil counters). Every row opens the person; followers can
 * be followed back or removed (with a confirmation — they are not notified), followed people unfollowed.
 */
export function PeopleListScreen({ kind }: { kind: 'followers' | 'following' }) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const followers = useFollowers(kind === 'followers');
  const following = useFollowing(kind === 'following');
  const query = kind === 'followers' ? followers : following;
  const removeFollower = useRemoveFollower();
  const [removing, setRemoving] = useState<PersonSuggestion | null>(null);

  return (
    <Screen bottom>
      <ScreenHeader title={t(kind === 'followers' ? 'friends.followersTitle' : 'friends.followingTitle')} leading="back" />
      <ScreenState
        query={query}
        isEmpty={(list) => list.length === 0}
        empty={{
          message: t(kind === 'followers' ? 'friends.followersEmpty' : 'friends.followingEmpty'),
          actionLabel: t('friends.emptyAction'),
          onAction: () => router.push('/friends/find'),
        }}
      >
        {(list) => (
          <FlatList
            data={list}
            keyExtractor={(p) => p.handle}
            contentContainerClassName="gap-2 pb-8 pt-2"
            refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.muted} />}
            renderItem={({ item }) => (
              <PersonListRow person={item}>
                <View className="flex-row items-center gap-2">
                  <FollowChip handle={item.handle} state={item.followState} />
                  {kind === 'followers' ? (
                    <RowAction
                      label={t('friends.remove')}
                      hint={t('friends.removeA11y', { name: item.displayName })}
                      onPress={() => setRemoving(item)}
                      testID={`followers.remove.${item.handle}`}
                    />
                  ) : null}
                </View>
              </PersonListRow>
            )}
          />
        )}
      </ScreenState>

      <ConfirmDialog
        visible={removing !== null}
        onCancel={() => setRemoving(null)}
        title={t('friends.removeTitle')}
        actions={
          <>
            <DangerButton
              label={t('friends.remove')}
              onPress={() => {
                if (removing) removeFollower(removing.handle);
                setRemoving(null);
              }}
            />
            <Button variant="secondary" label={t('common.cancel')} onPress={() => setRemoving(null)} testID="followers.remove.cancel" />
          </>
        }
      >
        <Text variant="body">{t('friends.removeBody', { name: removing?.displayName ?? '' })}</Text>
      </ConfirmDialog>
    </Screen>
  );
}
