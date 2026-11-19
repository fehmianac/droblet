import { router, useLocalSearchParams } from 'expo-router';
import { Ban, Ellipsis, Flag, Link, Lock } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { linkDomain } from '@/api/config';
import type { PersonProfile, PersonTile, PersonTrip } from '@/api/contracts/social';
import { Avatar, Card } from '@/components/blocks/basics';
import { MenuRow } from '@/components/blocks/rows';
import { SectionState } from '@/components/blocks/SectionState';
import { PopoverMenu } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { profileShareUrl } from '@/features/social/feedMath';
import { useAnswerFollowRequest, useFollow } from '@/features/social/mutations';
import { useNotice } from '@/features/social/Notice';
import { FOLLOW_LABEL } from '@/features/social/PeopleRows';
import { useInviteLink, usePerson, usePersonItems, usePersonLooks, usePersonTrips } from '@/features/social/queries';
import { ReportSheet } from '@/features/social/ReportSheet';
import { requestShareUrl } from '@/features/social/share';
import { useHandleGate } from '@/features/requirements/useHandleGate';
import { copyLink } from '@/features/social/ShareSheet';
import { formatNumber, formatPercent, formatYearMonth } from '@/lib/format';

type ProfileTab = 'looks' | 'closet' | 'trips';

/** Distance from the top of the header to the ⋯ menu (canvas `.menu`, `top:52px`). */
const MENU_OFFSET = 52;

function GridSkeleton() {
  return (
    <View className="flex-row gap-1 px-1">
      {[0, 1, 2].map((i) => (
        <View key={i} className="flex-1">
          <Skeleton className="h-[170px] w-full rounded" />
        </View>
      ))}
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View className="items-center" accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="total">{value}</Text>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * Three columns, 4 apart and 4 from the screen edge, 170 high tiles (as drawn). Without a picture a look
 * shows the standing figure (ground picked by its id) and a piece its category glyph on its colour.
 */
function TileGrid({ tiles, figure = false }: { tiles: PersonTile[]; figure?: boolean }) {
  const rows: PersonTile[][] = [];
  for (let i = 0; i < tiles.length; i += 3) rows.push(tiles.slice(i, i + 3));
  return (
    <View className="gap-1 px-1">
      {rows.map((row) => (
        <View key={row[0]?.id} className="flex-row gap-1">
          {row.map((tile) => (
            <ImageSlot
              key={tile.id}
              uri={tile.imageUrl}
              className="h-[170px] flex-1 rounded"
              accessibilityLabel={tile.name}
              placeholder={
                figure
                  ? { kind: 'look', pieces: [], seed: tile.id, figureHeight: 105 }
                  : { kind: 'garment', category: tile.category, color: tile.color, glyphSize: 48 }
              }
            />
          ))}
          {Array.from({ length: 3 - row.length }, (_, i) => (
            <View key={`pad-${i}`} className="flex-1" />
          ))}
        </View>
      ))}
    </View>
  );
}

/** `KisiGizli` — the dashed box shown whenever the server does not let this viewer see the closet. */
function HiddenCloset({ name }: { name: string }) {
  const { t } = useTranslation();
  return (
    <View className="px-gutter pt-2">
      <View className="items-center gap-3 rounded-card border-[1.5px] border-dashed border-muted/50 px-6 py-8">
        <View className="h-16 w-16 items-center justify-center rounded-pill bg-sand">
          <Icon icon={Lock} size={28} />
        </View>
        <Text variant="h3" className="text-center">
          {t('person.hiddenTitle')}
        </Text>
        <Text variant="body" tone="muted" className="text-center">
          {t('person.hiddenBody', { name })}
        </Text>
      </View>
    </View>
  );
}

function PersonBody({ person }: { person: PersonProfile }) {
  const { t } = useTranslation();
  const follow = useFollow();
  const answer = useAnswerFollowRequest();
  const [tab, setTab] = useState<ProfileTab>('looks');
  const visible = person.closetVisible;
  const looks = usePersonLooks(person.handle, visible && tab === 'looks');
  const items = usePersonItems(person.handle, visible && tab === 'closet');
  const trips = usePersonTrips(person.handle, visible && tab === 'trips');

  const tags = person.styleTags.map((tag) => t(`style.tags.${tag}`));
  const count = (value: number | null) => (value === null ? '—' : formatNumber(value));
  const hidden = <HiddenCloset name={person.displayName} />;

  return (
    <ScrollView contentContainerClassName="gap-3.5 pb-10 pt-1">
      <View className="items-center gap-2 px-gutter">
        <Avatar name={person.displayName} uri={person.avatarUrl} size={84} />
        <Text variant="h2" className="text-center" accessibilityRole="header">
          {person.displayName}
        </Text>
        <Text variant="caption" tone="muted" className="text-center">
          {[`@${person.handle}`, ...tags].join(' · ')}
        </Text>
        <View className="mt-1 flex-row gap-7">
          <Stat value={count(person.itemCount)} label={t('person.statItems')} />
          <Stat value={count(person.lookCount)} label={t('person.statLooks')} />
          <Stat value={formatPercent(person.styleMatch)} label={t('person.statMatch')} />
        </View>
        <View className="mt-1.5 flex-row items-center gap-2 self-stretch">
          {person.isSelf ? null : (
            <Button
              className="flex-1"
              size="md"
              variant={person.followState === 'none' ? 'primary' : 'secondary'}
              label={t(FOLLOW_LABEL[person.followState])}
              // Takip et → follow (public) or request (others); İstek gönderildi → withdraw; Takip ediliyor → unfollow.
              onPress={() => follow(person.handle, person.followState === 'none')}
              accessibilityHint={
                person.followState === 'requested'
                  ? t('friends.requestedHint')
                  : person.followState === 'following'
                    ? t('friends.followingHint')
                    : undefined
              }
              testID="person.follow"
            />
          )}
          {visible ? (
            <Button variant="secondary" size="md" className="flex-1" label={t('person.exploreCloset')} onPress={() => setTab('closet')} />
          ) : null}
        </View>
      </View>

      {person.requestedYou ? (
        <View className="px-gutter">
          <Card className="gap-3 p-4">
            <Text variant="bodyMedium">{t('friends.requestedYou', { name: person.displayName })}</Text>
            <View className="flex-row gap-2">
              <Button
                className="flex-1"
                label={t('friends.approve')}
                onPress={() => answer(person.handle, 'approve')}
                accessibilityHint={t('friends.approveA11y', { name: person.displayName })}
                testID="person.approve"
              />
              <Button
                className="flex-1"
                variant="secondary"
                label={t('friends.decline')}
                onPress={() => answer(person.handle, 'decline')}
                accessibilityHint={t('friends.declineA11y', { name: person.displayName })}
                testID="person.decline"
              />
            </View>
          </Card>
        </View>
      ) : null}

      {visible ? (
        <>
          <View className="flex-row justify-center gap-2 px-gutter" accessibilityRole="tablist" accessibilityLabel={t('person.tabsLabel')}>
            <Chip label={t('person.tabLooks')} selected={tab === 'looks'} onPress={() => setTab('looks')} />
            <Chip label={t('person.tabCloset')} selected={tab === 'closet'} onPress={() => setTab('closet')} />
            <Chip label={t('person.tabTrips')} selected={tab === 'trips'} onPress={() => setTab('trips')} />
          </View>

          {tab === 'looks' ? (
            <SectionState
              query={looks}
              skeleton={<GridSkeleton />}
              isEmpty={(list) => list !== null && list.length === 0}
              emptyText={t('person.looksEmpty', { name: person.displayName })}
            >
              {(list) => (list === null ? hidden : <TileGrid tiles={list} figure />)}
            </SectionState>
          ) : null}

          {tab === 'closet' ? (
            <SectionState
              query={items}
              skeleton={<GridSkeleton />}
              isEmpty={(list) => list !== null && list.length === 0}
              emptyText={t('person.closetEmpty', { name: person.displayName })}
            >
              {(list) => (list === null ? hidden : <TileGrid tiles={list} />)}
            </SectionState>
          ) : null}

          {tab === 'trips' ? (
            <SectionState
              query={trips}
              skeleton={
                <View className="px-gutter">
                  <Skeleton className="h-btn-primary w-full rounded-card" />
                </View>
              }
              isEmpty={(list) => list !== null && list.length === 0}
              emptyText={t('person.tripsEmpty', { name: person.displayName })}
            >
              {(list: PersonTrip[] | null) =>
                list === null ? (
                  hidden
                ) : (
                  <View className="px-gutter">
                    <Card>
                      {list.map((trip, index) => (
                        <MenuRow
                          key={trip.id}
                          first={index === 0}
                          label={t('person.tripMeta', { city: trip.city, month: formatYearMonth(trip.month) })}
                        />
                      ))}
                    </Card>
                  </View>
                )
              }
            </SectionState>
          ) : null}
        </>
      ) : (
        hidden
      )}
    </ScrollView>
  );
}

/**
 * 26 Kişi profili — follow, Looklar / Dolap / Seyahatler honouring what the server lets this viewer
 * see (`KisiGizli` otherwise), and the ⋯ menu as drawn: "Profil linkini kopyala", then 26b
 * Şikayet et / Engelle. A detail screen: no bottom menu.
 */
export default function PersonScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const person = usePerson(handle);
  const invite = useInviteLink();
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const { show } = useNotice();

  const withHandle = useHandleGate();
  const copyProfileLinkNow = async () => {
    const local = profileShareUrl(linkDomain(), handle, invite.data?.code ?? null);
    // The server records the share and returns the link to send; offline, the device-built link is used.
    const url = (await requestShareUrl({ targetKind: 'profile', ownerHandle: handle }, 'link')) ?? local;
    if (await copyLink(url)) show(t('person.linkCopied'));
    else show(t('share.copyFailed'), 'problem');
  };
  // The profile link carries my invite code and names me: it needs my @handle first.
  const copyProfileLink = () => withHandle(() => void copyProfileLinkNow());
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/friends/feed'));

  return (
    <Screen bottom>
      <ScreenHeader
        leading="back"
        right={
          person.data ? (
            <IconButton
              icon={Ellipsis}
              testID="person-more"
              onPress={() => setMenu(true)}
              accessibilityLabel={t('person.more')}
            />
          ) : undefined
        }
      />
      <ScreenState
        query={person}
        isEmpty={(data) => data === null}
        empty={{ message: t('person.notFound'), actionLabel: t('person.notFoundAction'), onAction: goBack }}
      >
        {(data) => (data ? <PersonBody key={data.handle} person={data} /> : null)}
      </ScreenState>

      <PopoverMenu
        visible={menu}
        onClose={() => setMenu(false)}
        top={insets.top + MENU_OFFSET}
        actions={[
          { key: 'copy', label: t('person.copyProfile'), icon: Link, onPress: () => void copyProfileLink() },
          { key: 'report', label: t('person.report'), icon: Flag, destructive: true, onPress: () => setReporting(true) },
          { key: 'block', label: t('person.block'), icon: Ban, destructive: true, onPress: () => setReporting(true) },
        ]}
      />

      {person.data ? (
        <ReportSheet
          visible={reporting}
          onClose={() => setReporting(false)}
          handle={person.data.handle}
          displayName={person.data.displayName}
          onReported={() => show(t('report.sent'))}
          // Canvas: "Engelle" leads back to the friend feed.
          onBlocked={() => router.dismissTo('/friends/feed')}
        />
      ) : null}
    </Screen>
  );
}
