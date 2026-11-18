import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, View } from 'react-native';

import type { FollowRequestDirection } from '@/api/contracts/social';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useAnswerFollowRequest } from '@/features/social/mutations';
import { PersonListRow, RowAction } from '@/features/social/PeopleRows';
import { useFollowRequests } from '@/features/social/queries';
import { useThemeColors } from '@/theme/useThemeColors';

/**
 * Takip istekleri — people asking to follow a followers-only / private closet (approve / decline)
 * and my own pending requests (withdraw). Reached from Profil, Arkadaş akışı, Dolapları keşfet and
 * the `follow_request` push. `?tab=outgoing` opens the sent list.
 */
export default function FollowRequestsScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<FollowRequestDirection>(params.tab === 'outgoing' ? 'outgoing' : 'incoming');
  const requests = useFollowRequests(tab);
  const answer = useAnswerFollowRequest();

  return (
    <Screen bottom>
      <ScreenHeader title={t('friends.requestsTitle')} leading="back" />
      <View className="px-gutter pb-3">
        <SegmentedControl
          segments={[
            { value: 'incoming', label: t('friends.incoming') },
            { value: 'outgoing', label: t('friends.outgoing') },
          ]}
          value={tab}
          onChange={setTab}
          accessibilityLabel={t('friends.requestsTabs')}
          testID="requests.tab"
        />
      </View>
      <ScreenState
        query={requests}
        isEmpty={(list) => list.length === 0}
        empty={{
          message: t(tab === 'incoming' ? 'friends.incomingEmpty' : 'friends.outgoingEmpty'),
          actionLabel: t('friends.emptyAction'),
          onAction: () => router.push('/friends/find'),
        }}
      >
        {(list) => (
          <FlatList
            data={list}
            keyExtractor={(r) => r.person.handle}
            contentContainerClassName="gap-2 pb-8"
            refreshControl={
              <RefreshControl refreshing={requests.isRefetching} onRefresh={() => void requests.refetch()} tintColor={colors.muted} />
            }
            renderItem={({ item }) => {
              const { person } = item;
              const name = person.displayName;
              return (
                <PersonListRow person={person} subtitle={`@${person.handle}`}>
                  {tab === 'incoming' ? (
                    <View className="flex-row gap-2">
                      <RowAction
                        primary
                        label={t('friends.approve')}
                        hint={t('friends.approveA11y', { name })}
                        onPress={() => answer(person.handle, 'approve')}
                        testID={`requests.approve.${person.handle}`}
                      />
                      <RowAction
                        label={t('friends.decline')}
                        hint={t('friends.declineA11y', { name })}
                        onPress={() => answer(person.handle, 'decline')}
                        testID={`requests.decline.${person.handle}`}
                      />
                    </View>
                  ) : (
                    <RowAction
                      label={t('friends.withdraw')}
                      hint={t('friends.withdrawA11y', { name })}
                      onPress={() => answer(person.handle, 'cancel')}
                      testID={`requests.withdraw.${person.handle}`}
                    />
                  )}
                </PersonListRow>
              );
            }}
          />
        )}
      </ScreenState>
    </Screen>
  );
}
