import { router, useLocalSearchParams } from 'expo-router';
import { Ellipsis, Lock } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Share, View } from 'react-native';

import { linkDomain } from '@/api/config';
import type { PersonProfile, PersonTile, PersonTrip } from '@/api/contracts/social';
import { Avatar, Card } from '@/components/blocks/basics';
import { MenuRow } from '@/components/blocks/rows';
import { SectionState } from '@/components/blocks/SectionState';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { profileShareUrl } from '@/features/social/feedMath';
import { useFollow } from '@/features/social/mutations';
import { useInviteLink, usePerson, usePersonItems, usePersonLooks, usePersonTrips } from '@/features/social/queries';
import { ReportSheet } from '@/features/social/ReportSheet';
import { formatYearMonth , formatNumber, formatPercent } from '@/lib/format';

type ProfileTab = 'looks' | 'closet' | 'trips';

function ProfileSkeleton() {
  return (
    <View className="items-center gap-4 px-gutter pt-4">
      <Skeleton className="h-20 w-20 rounded-pill" />
      <Skeleton className="h-7 w-32 rounded-field" />
      <Skeleton className="h-14 w-full rounded-card" />
      <Skeleton className="h-btn-primary w-full rounded-pill" />
    </View>
  );
}

function GridSkeleton() {
  return (
    <View className="flex-row gap-2 px-gutter">
      {[0, 1, 2].map((i) => (
        <View key={i} className="flex-1">
          <Skeleton className="aspect-[4/5] w-full rounded-image" />
        </View>
      ))}
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View className="flex-1 items-center gap-0.5" accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="h3">{value}</Text>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function TileGrid({ tiles }: { tiles: PersonTile[] }) {
  const rows: PersonTile[][] = [];
  for (let i = 0; i < tiles.length; i += 3) rows.push(tiles.slice(i, i + 3));
  return (
    <View className="gap-2 px-gutter">
      {rows.map((row) => (
        <View key={row[0]?.id} className="flex-row gap-2">
          {row.map((tile) => (
            <View key={tile.id} className="flex-1">
              <PlaceholderImage uri={tile.imageUrl} className="aspect-[4/5] w-full rounded-image" accessibilityLabel={tile.name} />
            </View>
          ))}
          {Array.from({ length: 3 - row.length }, (_, i) => (
            <View key={`pad-${i}`} className="flex-1" />
          ))}
        </View>
      ))}
    </View>
  );
}

/** `KisiGizli` — shown whenever the server does not let this viewer see the closet. */
function HiddenCloset({ name }: { name: string }) {
  const { t } = useTranslation();
  return (
    <View className="items-center gap-3 px-gutter py-10">
      <View className="h-16 w-16 items-center justify-center rounded-pill bg-sand">
        <Icon icon={Lock} size={24} tone="accent" />
      </View>
      <Text variant="h3" className="text-center">
        {t('person.hiddenTitle')}
      </Text>
      <Text variant="body" tone="muted" className="text-center">
        {t('person.hiddenBody', { name })}
      </Text>
    </View>
  );
}

function PersonBody({ person }: { person: PersonProfile }) {
  const { t } = useTranslation();
  const follow = useFollow();
  const [tab, setTab] = useState<ProfileTab>('looks');
  const visible = person.closetVisible;
  const looks = usePersonLooks(person.handle, visible && tab === 'looks');
  const items = usePersonItems(person.handle, visible && tab === 'closet');
  const trips = usePersonTrips(person.handle, visible && tab === 'trips');

  const tags = person.styleTags.map((tag) => t(`style.tags.${tag}`));
  const count = (value: number | null) => (value === null ? '—' : formatNumber(value));
  const hidden = <HiddenCloset name={person.displayName} />;

  return (
    <ScrollView contentContainerClassName="gap-6 pb-10">
      <View className="items-center gap-3 px-gutter">
        <Avatar name={person.displayName} uri={person.avatarUrl} size={80} />
        <View className="items-center gap-1">
          <Text variant="h2">{person.displayName}</Text>
          <Text variant="caption" tone="muted" className="text-center">
            {[`@${person.handle}`, ...tags].join(' · ')}
          </Text>
        </View>
        <View className="flex-row self-stretch py-1">
          <Stat value={count(person.itemCount)} label={t('person.statItems')} />
          <Stat value={count(person.lookCount)} label={t('person.statLooks')} />
          <Stat value={formatPercent(person.styleMatch)} label={t('person.statMatch')} />
        </View>
        <View className="flex-row items-center gap-3 self-stretch">
          <Button
            className="flex-1"
            variant={person.isFollowing ? 'secondary' : 'primary'}
            label={t(person.isFollowing ? 'person.following' : 'person.follow')}
            onPress={() => follow(person.handle, !person.isFollowing)}
          />
          {visible ? (
            <Button variant="secondary" className="flex-1" label={t('person.exploreCloset')} onPress={() => setTab('closet')} />
          ) : null}
        </View>
      </View>

      {visible ? (
        <View className="gap-4">
          <View className="flex-row gap-2 px-gutter" accessibilityRole="tablist" accessibilityLabel={t('person.tabsLabel')}>
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
              {(list) => (list === null ? hidden : <TileGrid tiles={list} />)}
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
        </View>
      ) : (
        hidden
      )}
    </ScrollView>
  );
}

/**
 * 26 Kişi profili — follow, Looklar / Dolap / Seyahatler honouring what the server lets this viewer
 * see (`KisiGizli` otherwise), and ⋯ → profile link, 26b Şikayet et / Engelle.
 */
export default function PersonScreen() {
  const { t } = useTranslation();
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const person = usePerson(handle);
  const invite = useInviteLink();
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);

  const shareProfile = () => {
    setMenu(false);
    const url = profileShareUrl(linkDomain(), handle, invite.data?.code ?? null);
    void Share.share({ message: t('share.profileMessage', { url }) }).catch(() => undefined);
  };
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/friends/feed'));

  return (
    <Screen bottom>
      <ScreenHeader
        leading="back"
        right={
          person.data ? (
            <IconButton icon={Ellipsis} variant="plain" onPress={() => setMenu(true)} accessibilityLabel={t('person.more')} />
          ) : undefined
        }
      />
      <ScreenState
        query={person}
        skeleton={<ProfileSkeleton />}
        isEmpty={(data) => data === null}
        empty={{ message: t('person.notFound'), actionLabel: t('person.notFoundAction'), onAction: goBack }}
      >
        {(data) => (data ? <PersonBody key={data.handle} person={data} /> : null)}
      </ScreenState>

      <BottomSheet visible={menu} onClose={() => setMenu(false)}>
        <Card>
          <MenuRow first label={t('person.shareProfile')} onPress={shareProfile} />
          <MenuRow
            label={t('person.report')}
            onPress={() => {
              setMenu(false);
              setReporting(true);
            }}
          />
          <MenuRow
            label={t('person.block')}
            onPress={() => {
              setMenu(false);
              setReporting(true);
            }}
          />
        </Card>
      </BottomSheet>

      {person.data ? (
        <ReportSheet
          visible={reporting}
          onClose={() => setReporting(false)}
          handle={person.data.handle}
          displayName={person.data.displayName}
          onBlocked={goBack}
        />
      ) : null}
    </Screen>
  );
}
