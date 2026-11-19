import { router } from 'expo-router';
import { AtSign, UserCheck, Users } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Share, View } from 'react-native';

import { track } from '@/analytics/track';
import { PEOPLE_SEARCH_MIN, type PersonSuggestion } from '@/api/contracts/social';
import { Badge, Card, SearchField } from '@/components/blocks/basics';
import { MenuRow } from '@/components/blocks/rows';
import { SectionState } from '@/components/blocks/SectionState';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { ListTabBar } from '@/components/navigation/TabBar';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useHandleGate, useHandleMissing } from '@/features/requirements/useHandleGate';
import { requirementsFlow } from '@/features/requirements/store';
import { FollowChip, PersonListRow } from '@/features/social/PeopleRows';
import { useIncomingRequestCount, useInviteLink, usePeopleSearch, useSuggestedPeople } from '@/features/social/queries';
import { useCreators } from '@/features/store/queries';

function PersonRow({ person }: { person: PersonSuggestion }) {
  return (
    <PersonListRow person={person}>
      <FollowChip handle={person.handle} state={person.followState} />
    </PersonListRow>
  );
}

function RowsSkeleton() {
  return (
    <View className="gap-3 px-gutter">
      {[0, 1].map((i) => (
        <Skeleton key={i} className="h-14 w-full rounded-card" />
      ))}
    </View>
  );
}

/**
 * 27 Dolapları keşfet — @username search, the contacts card (owner decision 13: opens the consent
 * screen first; the permission is only asked there), invite link sharing, creator closets that have
 * a Droblet account (hidden when there are none), "Sana benzeyen dolaplar" with the style match %,
 * and the waiting follow requests.
 */
export default function FindFriendsScreen() {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [inviteError, setInviteError] = useState(false);
  const withHandle = useHandleGate();
  const handleMissing = useHandleMissing();

  useEffect(() => {
    const handle = setTimeout(() => setQuery(text), 300);
    return () => clearTimeout(handle);
  }, [text]);

  const search = usePeopleSearch(query);
  const suggested = useSuggestedPeople();
  const creators = useCreators();
  const invite = useInviteLink();
  const requestCount = useIncomingRequestCount();
  const creatorAccounts = creators.data?.filter((c) => c.handle !== null) ?? [];
  // The server searches from 2 characters on (the leading @ does not count).
  const searching = query.trim().replace(/^@/, '').length >= PEOPLE_SEARCH_MIN;

  const shareInviteNow = async () => {
    setInviteError(false);
    const link = invite.data ?? (await invite.refetch()).data;
    if (!link) {
      setInviteError(true);
      return;
    }
    try {
      await Share.share({ message: t('share.inviteMessage', { url: link.url }) });
      track('look_shared', { channel: 'link', kind: 'invite' });
    } catch {
      setInviteError(true);
    }
  };

  return (
    <Screen>
      <ScreenHeader title={t('screens.friendsFind')} leading="back" />
      <ScrollView contentContainerClassName="gap-6 pb-10" keyboardShouldPersistTaps="handled">
        <View className="px-gutter">
          <SearchField
            value={text}
            onChangeText={setText}
            label={t('people.searchLabel')}
            placeholder={t('people.searchLabel')}
            clearLabel={t('shop.clearSearch')}
          />
        </View>

        {searching ? (
          <SectionState
            query={search}
            skeleton={<RowsSkeleton />}
            isEmpty={(list) => list.length === 0}
            emptyText={t('people.searchEmpty', { query: query.trim() })}
            errorText={t('people.searchError')}
          >
            {(list) => (
              <View className="gap-2">
                {list.map((p) => (
                  <PersonRow key={p.handle} person={p} />
                ))}
              </View>
            )}
          </SectionState>
        ) : (
          <>
            {handleMissing ? (
              // Friends find you by your @handle; following, sharing and inviting ask for it first.
              <View className="px-gutter">
                <Card>
                  <MenuRow
                    first
                    icon={AtSign}
                    label={t('people.claimHandle')}
                    onPress={() => requirementsFlow.open({ action: 'social', start: 'steps', only: 'handle' })}
                    testID="find.claimHandle"
                  />
                </Card>
              </View>
            ) : null}
            {requestCount > 0 ? (
              <View className="px-gutter">
                <Card>
                  <MenuRow
                    first
                    icon={UserCheck}
                    label={t('friends.requestsBanner', { count: requestCount })}
                    onPress={() => router.push('/friends/requests')}
                  />
                </Card>
              </View>
            ) : null}

            <View className="px-gutter">
              <Card className="gap-4 p-4">
                <View className="flex-row gap-3">
                  <View className="h-icon-btn w-icon-btn items-center justify-center rounded-pill bg-sand">
                    <Icon icon={Users} size={20} tone="accent" />
                  </View>
                  <View className="flex-1 gap-1">
                    <Text variant="bodyMedium">{t('people.contactsTitle')}</Text>
                    <Text variant="caption" tone="muted">
                      {t('people.contactsBody')}
                    </Text>
                  </View>
                </View>
                <View className="gap-2">
                  <Button label={t('people.contactsAllow')} onPress={() => router.push('/friends/contacts')} testID="find.contacts" />
                  <Button variant="secondary" label={t('people.inviteLink')} onPress={() => withHandle(() => void shareInviteNow(), t('people.inviteLink'))} testID="find.invite" />
                </View>
                {inviteError ? (
                  <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
                    {t('share.linkUnavailable')}
                  </Text>
                ) : null}
              </Card>
            </View>

            {/* Creator closets with a Droblet account (`handle`); the row is hidden while there are none. */}
            {creatorAccounts.length > 0 ? (
              <View className="gap-3">
                <View className="flex-row items-center gap-2 px-gutter">
                  <Text variant="h3">{t('people.influencers')}</Text>
                  <Badge label={t('people.sample')} />
                </View>
                <View className="flex-row gap-3 px-gutter">
                  {creatorAccounts.slice(0, 2).map((c) => (
                    <Pressable
                      key={c.id}
                      onPress={() => c.handle && router.push({ pathname: '/u/[handle]', params: { handle: c.handle } })}
                      accessibilityRole="button"
                      accessibilityLabel={[c.displayName, c.role ? t('people.placeholderRole', { role: c.role }) : null]
                        .filter(Boolean)
                        .join(', ')}
                      testID={`find.creator.${c.handle}`}
                      className="flex-1 active:opacity-80"
                    >
                      <Card className="gap-2 p-3">
                        <ImageSlot uri={c.imageUrl} className="aspect-[4/5] w-full rounded-image" placeholder={{ kind: 'look', pieces: [], seed: c.id }} />
                        <Text variant="bodyMedium" numberOfLines={1}>
                          {c.displayName}
                        </Text>
                        {c.role ? (
                          <Text variant="caption" tone="muted" numberOfLines={2}>
                            {t('people.placeholderRole', { role: c.role })}
                          </Text>
                        ) : null}
                      </Card>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            <View className="gap-3">
              <Text variant="h3" className="px-gutter">
                {t('people.similar')}
              </Text>
              <SectionState
                query={suggested}
                skeleton={<RowsSkeleton />}
                isEmpty={(list) => list.length === 0}
                emptyText={t('people.similarEmpty')}
              >
                {(list) => (
                  <View className="gap-2">
                    {list.map((p) => (
                      <PersonRow key={p.handle} person={p} />
                    ))}
                  </View>
                )}
              </SectionState>
            </View>
          </>
        )}
      </ScrollView>
      <ListTabBar owner="discover" />
    </Screen>
  );
}
