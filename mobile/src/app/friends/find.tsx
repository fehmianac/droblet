import { router } from 'expo-router';
import { Search, Users, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Share, TextInput, View } from 'react-native';

import { track } from '@/analytics/track';
import { PEOPLE_SEARCH_MIN, type PersonSuggestion } from '@/api/contracts/social';
import { Avatar, Card } from '@/components/blocks/basics';
import { SectionState } from '@/components/blocks/SectionState';
import { Badge } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { ListTabBar } from '@/components/navigation/TabBar';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useFollow } from '@/features/social/mutations';
import { Notice, useNotice } from '@/features/social/Notice';
import { useInviteLink, usePeopleSearch, useSuggestedPeople } from '@/features/social/queries';
import { copyLink } from '@/features/social/ShareSheet';
import { useCreators } from '@/features/store/queries';
import { formatPercent } from '@/lib/format';
import { useThemeColors } from '@/theme/useThemeColors';

/** The search pill as drawn on 27: 48 high, fully rounded, magnifier 16 from the edge. */
function PeopleSearch({ value, onChangeText }: { value: string; onChangeText: (value: string) => void }) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  return (
    <View className="h-field flex-row items-center rounded-pill border border-line bg-paper pl-4">
      <Icon icon={Search} size={18} tone="muted" />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={t('people.searchLabel')}
        placeholder={t('people.searchLabel')}
        placeholderTextColor={colors.muted}
        selectionColor={colors.accent}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        maxFontSizeMultiplier={1.6}
        className="h-full flex-1 pl-2 pr-3 font-sans text-button text-ink"
      />
      {value !== '' ? (
        <Pressable
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          accessibilityLabel={t('shop.clearSearch')}
          className="h-icon-btn w-icon-btn items-center justify-center"
        >
          <Icon icon={X} size={18} tone="muted" />
        </Pressable>
      ) : null}
    </View>
  );
}

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
        className="min-h-icon-btn flex-1 flex-row items-center gap-3 active:opacity-80"
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
      {/* Outlined in both states, as drawn; the text carries the state. */}
      <Chip
        label={t(person.isFollowing ? 'feed.following' : 'feed.follow')}
        accessibilityHint={t(person.isFollowing ? 'feed.unfollowHint' : 'feed.followHint', { name: person.displayName })}
        onPress={() => follow(person.handle, !person.isFollowing)}
      />
    </View>
  );
}

function RowsSkeleton() {
  return (
    <View className="gap-3.5 px-gutter">
      {[0, 1].map((i) => (
        <Skeleton key={i} className="h-11 w-full rounded-card" />
      ))}
    </View>
  );
}

/**
 * 27 Dolapları keşfet — @username search, the contacts card, invite link sharing, placeholder
 * influencer closets ("Örnek") and "Sana benzeyen dolaplar" with the style match %.
 *
 * Contacts matching is still an open product decision (A-8) and no contacts module is installed, so
 * "Rehbere izin ver" is drawn as on the canvas but never asks for a permission: it says the feature
 * is on its way and points at the invite link.
 */
export default function FindFriendsScreen() {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const { notice, show } = useNotice();

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
    const link = invite.data ?? (await invite.refetch()).data;
    if (!link) {
      show(t('share.linkUnavailable'), 'problem');
      return;
    }
    try {
      await Share.share({ message: t('share.inviteMessage', { url: link.url }) });
      track('look_shared', { channel: 'link', kind: 'invite' });
    } catch {
      // The system share sheet could not open: put the link on the clipboard instead.
      if (await copyLink(link.url)) show(t('share.copied'));
      else show(t('share.copyFailed'), 'problem');
    }
  };

  return (
    <Screen>
      <ScreenHeader title={t('screens.friendsFind')} leading="back" />
      <ScrollView contentContainerClassName="gap-3.5 pb-10 pt-1" keyboardShouldPersistTaps="handled">
        <View className="px-gutter">
          <PeopleSearch value={text} onChangeText={setText} />
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
              <View className="gap-3.5">
                {list.map((p) => (
                  <PersonRow key={p.handle} person={p} />
                ))}
              </View>
            )}
          </SectionState>
        ) : (
          <>
            <View className="px-gutter">
              <Card className="gap-2.5 p-3.5">
                <View className="flex-row items-center gap-3">
                  <Icon icon={Users} size={22} />
                  <View className="flex-1">
                    <Text variant="bodyMedium">{t('people.contactsTitle')}</Text>
                    <Text variant="caption" tone="muted">
                      {t('people.contactsBody')}
                    </Text>
                  </View>
                </View>
                <View className="flex-row gap-2">
                  <Button
                    size="md"
                    className="flex-1 px-3"
                    label={t('people.contactsAllow')}
                    accessibilityHint={t('common.comingSoon')}
                    onPress={() => show(t('people.contactsSoon'))}
                  />
                  <Button size="md" variant="secondary" className="flex-1 px-3" label={t('people.inviteLink')} onPress={() => void shareInvite()} />
                </View>
              </Card>
            </View>

            <View className="flex-row items-center justify-between gap-3 px-gutter">
              <Text variant="h3" className="flex-1" accessibilityRole="header">
                {t('people.influencers')}
              </Text>
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
                <View className="flex-row gap-2.5 px-gutter">
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
                      <Card className="gap-1.5 p-2.5">
                        <ImageSlot
                          uri={c.imageUrl}
                          className="h-[110px] w-full rounded-thumb"
                          placeholder={{ kind: 'look', pieces: [], seed: c.id, figureHeight: 74 }}
                        />
                        <Text variant="segment" numberOfLines={1}>
                          {c.displayName}
                        </Text>
                        {c.role ? (
                          <Text variant="caption" tone="muted" numberOfLines={2} className="text-[11.5px] leading-[16px]">
                            {t('people.placeholderRole', { role: c.role })}
                          </Text>
                        ) : null}
                      </Card>
                    </Pressable>
                  ))}
                </View>
              )}
            </SectionState>

            <Text variant="h3" className="px-gutter" accessibilityRole="header">
              {t('people.similar')}
            </Text>
            <SectionState
              query={suggested}
              skeleton={<RowsSkeleton />}
              isEmpty={(list) => list.length === 0}
              emptyText={t('people.similarEmpty')}
            >
              {(list) => (
                <View className="gap-3.5">
                  {list.map((p) => (
                    <PersonRow key={p.handle} person={p} />
                  ))}
                </View>
              )}
            </SectionState>
          </>
        )}
      </ScrollView>
      <Notice notice={notice} />
      <ListTabBar owner="discover" />
    </Screen>
  );
}
