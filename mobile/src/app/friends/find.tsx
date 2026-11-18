import { router } from 'expo-router';
import { Users } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Share, View } from 'react-native';

import { track } from '@/analytics/track';
import { PEOPLE_SEARCH_MIN, type PersonSuggestion } from '@/api/contracts/social';
import { Avatar, Badge, Card, SearchField } from '@/components/blocks/basics';
import { SectionState } from '@/components/blocks/SectionState';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useFollow } from '@/features/social/mutations';
import { useInviteLink, usePeopleSearch, useSuggestedPeople } from '@/features/social/queries';
import { useCreators } from '@/features/store/queries';
import { formatPercent } from '@/lib/format';

function PersonRow({ person }: { person: PersonSuggestion }) {
  const { t } = useTranslation();
  const follow = useFollow();
  const match = t('people.matchPercent', { percent: formatPercent(person.styleMatch) });
  return (
    <View className="flex-row items-center gap-3 px-gutter">
      <Pressable
        onPress={() => router.push({ pathname: '/u/[handle]', params: { handle: person.handle } })}
        accessibilityRole="button"
        accessibilityLabel={`${person.displayName}, ${match}`}
        className="min-h-14 flex-1 flex-row items-center gap-3 active:opacity-80"
      >
        <Avatar name={person.displayName} uri={person.avatarUrl} size={44} />
        <View className="flex-1">
          <Text variant="bodyMedium" numberOfLines={1}>
            {person.displayName}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {match}
          </Text>
        </View>
      </Pressable>
      <Chip
        label={t(person.isFollowing ? 'feed.following' : 'feed.follow')}
        selected={!person.isFollowing}
        onPress={() => follow(person.handle, !person.isFollowing)}
      />
    </View>
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
 * 27 Dolapları keşfet — @username search, the contacts card (shown as "Yakında": contacts matching
 * is an open decision, A-8, so no permission is requested), invite link sharing, placeholder
 * influencer closets and "Sana benzeyen dolaplar" with the style match %.
 */
export default function FindFriendsScreen() {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [inviteError, setInviteError] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => setQuery(text), 300);
    return () => clearTimeout(handle);
  }, [text]);

  const search = usePeopleSearch(query);
  const suggested = useSuggestedPeople();
  const creators = useCreators();
  const invite = useInviteLink();
  // The server searches from 2 characters on (the leading @ does not count).
  const searching = query.trim().replace(/^@/, '').length >= PEOPLE_SEARCH_MIN;

  const shareInvite = async () => {
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
    <Screen bottom>
      <ScreenHeader title={t('screens.friendsFind')} leading="back" />
      <OfflineBanner />
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
            <View className="px-gutter">
              <Card className="gap-4 p-4">
                <View className="flex-row gap-3">
                  <View className="h-icon-btn w-icon-btn items-center justify-center rounded-pill bg-sand">
                    <Icon icon={Users} size={20} tone="accent" />
                  </View>
                  <View className="flex-1 gap-1">
                    <View className="flex-row flex-wrap items-center gap-2">
                      <Text variant="bodyMedium">{t('people.contactsTitle')}</Text>
                      <Badge label={t('common.comingSoon')} />
                    </View>
                    <Text variant="caption" tone="muted">
                      {t('people.contactsBody')}
                    </Text>
                  </View>
                </View>
                <View className="gap-2">
                  <Button label={t('people.contactsAllow')} onPress={() => undefined} disabled accessibilityHint={t('common.comingSoon')} />
                  <Button variant="secondary" label={t('people.inviteLink')} onPress={() => void shareInvite()} />
                </View>
                {inviteError ? (
                  <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
                    {t('share.linkUnavailable')}
                  </Text>
                ) : null}
              </Card>
            </View>

            <View className="gap-3">
              <View className="flex-row items-center gap-2 px-gutter">
                <Text variant="h3">{t('people.influencers')}</Text>
                <Badge label={t('people.sample')} />
              </View>
              <SectionState
                query={{
                  data: creators.data?.filter((c) => c.handle !== null),
                  status: creators.status,
                  fetchStatus: creators.fetchStatus,
                  error: creators.error,
                  refetch: creators.refetch,
                }}
                skeleton={<RowsSkeleton />}
                isEmpty={(list) => list.length === 0}
                emptyText={t('people.influencersEmpty')}
              >
                {(list) => (
                  <View className="flex-row gap-3 px-gutter">
                    {list.slice(0, 2).map((c) => (
                      <Pressable
                        key={c.id}
                        onPress={() => c.handle && router.push({ pathname: '/u/[handle]', params: { handle: c.handle } })}
                        accessibilityRole="button"
                        accessibilityLabel={[c.displayName, c.role ? t('people.placeholderRole', { role: c.role }) : null]
                          .filter(Boolean)
                          .join(', ')}
                        className="flex-1 active:opacity-80"
                      >
                        <Card className="gap-2 p-3">
                          <PlaceholderImage uri={c.imageUrl} className="aspect-[4/5] w-full rounded-image" />
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
                )}
              </SectionState>
            </View>

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
    </Screen>
  );
}
