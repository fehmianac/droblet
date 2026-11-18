import { router, useLocalSearchParams } from 'expo-router';
import { Check, CircleAlert, Cloud, CloudRain, Ellipsis, Pencil, Snowflake, Sparkles, Sun, Trash2, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { TripDay, TripDetail, WeatherCondition } from '@/api/contracts/trips';
import { ITEM_CATEGORIES } from '@/api/contracts/wardrobe';
import { ImageTag, PopoverMenu } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { CreditConfirmSheet } from '@/features/credits/CreditConfirmSheet';
import { indexItems, LookCover } from '@/features/looks/LookCover';
import { useLooks } from '@/features/looks/queries';
import { useTrip, useTripWrites } from '@/features/trips/api';
import { groupByCategory, readiness, tripLengthDays } from '@/features/trips/logic';
import { ReadinessRing } from '@/features/trips/ReadinessRing';
import { TripPacking } from '@/features/trips/TripPacking';
import { useStartTryOn } from '@/features/tryon/api';
import { ItemThumb } from '@/features/wardrobe/ItemThumb';
import { useItems } from '@/features/wardrobe/queries';
import { currentLanguage } from '@/i18n';
import { formatDateRange, formatTemperature, parseLocalDate, weekdayShort } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';
import { useIsOnline } from '@/sync/network';
import { useThemeColors } from '@/theme/useThemeColors';

const WEATHER_ICON: Record<WeatherCondition, LucideIcon> = { sun: Sun, cloud: Cloud, rain: CloudRain, snow: Snowflake };

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/wardrobe/trips');
}

function TripSkeleton() {
  return (
    <View className="gap-5 px-gutter pt-2">
      <View className="gap-2">
        <Skeleton className="h-3 w-40 rounded-field" />
        <Skeleton className="h-9 w-1/2 rounded-field" />
      </View>
      <View className="flex-row gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 flex-1 rounded-image-lg" />
        ))}
      </View>
      <Skeleton className="h-24 w-full rounded-card" />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-11 w-full rounded-field" />
      ))}
    </View>
  );
}

function Forecast({ trip }: { trip: TripDetail }) {
  const { t } = useTranslation();
  if (!trip.forecast || trip.forecast.length === 0) {
    return (
      <Text variant="caption" tone="muted">
        {t('tripDetail.forecastUnavailable')}
      </Text>
    );
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={t('tripDetail.forecastLabel')}
      className="-mx-gutter"
      contentContainerClassName="gap-2 px-gutter"
    >
      {trip.forecast.map((day) => {
        const weekday = weekdayShort(parseLocalDate(day.date));
        const temperature = formatTemperature(day.temperatureC);
        return (
          <View
            key={day.date}
            accessible
            accessibilityLabel={t('tripDetail.forecastDay', { weekday, temperature, condition: t(`tripDetail.condition.${day.condition}`) })}
            className="min-w-[58px] items-center gap-1 rounded-image-lg border border-line bg-paper px-2 py-2.5"
          >
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {weekday}
            </Text>
            <Icon icon={WEATHER_ICON[day.condition]} size={18} />
            <Text variant="bodyMedium">{temperature}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

function DayLooks({ days }: { days: TripDay[] }) {
  const { t } = useTranslation();
  const looks = useLooks();
  const items = useItems();
  const itemsById = indexItems(items.data);
  const planned = days.filter((d) => d.look);
  if (planned.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={t('tripDetail.dailyLooks')}
      className="-mx-gutter"
      contentContainerClassName="gap-2.5 px-gutter"
    >
      {planned.map((day) => {
        const ref = day.look;
        if (!ref) return null;
        const weekday = weekdayShort(parseLocalDate(day.date));
        const look = looks.data?.find((l) => l.id === ref.id);
        return (
          <Pressable
            key={day.date}
            onPress={() => router.push({ pathname: '/look/new', params: { id: ref.id } })}
            accessibilityRole="button"
            accessibilityLabel={t('tripDetail.dayLook', { weekday, name: ref.name })}
            className="active:opacity-80"
          >
            <LookCover tryOnImageUrl={ref.imageUrl} slots={look?.slots ?? []} itemsById={itemsById} className="h-32 w-24 rounded-image">
              <ImageTag label={toDisplayUpper(weekday, currentLanguage())} className="absolute bottom-1.5 left-1.5" />
            </LookCover>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function PackedTrip({ trip }: { trip: TripDetail }) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const online = useIsOnline();
  const writes = useTripWrites();
  const tryOn = useStartTryOn();
  const [confirm, setConfirm] = useState(false);
  const [tryOnNote, setTryOnNote] = useState<'offline' | 'failed' | null>(null);

  const ready = readiness(trip.items);
  const lookDays = trip.days.filter((d) => d.look);
  const groups = groupByCategory(trip.items, ITEM_CATEGORIES);

  const startTryOn = () => {
    void (async () => {
      try {
        const jobs = await tryOn.startMany(lookDays.map((d) => ({ kind: 'trip-day' as const, id: `${trip.id}:${d.date}` })));
        setConfirm(false);
        const first = jobs[0];
        if (first) router.push({ pathname: '/tryon/[jobId]', params: { jobId: first.jobId, title: trip.cityName } });
      } catch {
        setConfirm(false);
        setTryOnNote('failed');
      }
    })();
  };

  return (
    <>
      <View className="flex-row items-center gap-3 rounded-card border border-line bg-paper p-4">
        <View className="flex-1 gap-1.5">
          <Text variant="bodyMedium">
            {t('tripDetail.summary', { pieces: t('trips.pieces', { count: trip.items.length }), looks: t('tripDetail.looks', { count: lookDays.length }) })}
          </Text>
          {trip.minWearsPerItem ? (
            <Text variant="caption" tone="muted">
              {t('tripDetail.minWears', { count: trip.minWearsPerItem })}
            </Text>
          ) : null}
          <View className="flex-row items-center gap-2.5 pt-1">
            <Switch
              value={trip.cabinOnly}
              onValueChange={(value) => writes.setCabinOnly(trip, value)}
              accessibilityLabel={t('tripDetail.cabinOnly')}
              trackColor={{ true: colors.ink, false: colors.line }}
              thumbColor={colors.paper}
              ios_backgroundColor={colors.line}
            />
            <Text variant="body" className="flex-1" accessible={false}>
              {t('tripDetail.cabinOnly')}
            </Text>
          </View>
        </View>
        <ReadinessRing {...ready} />
      </View>

      {trip.missing.map((piece) => (
        <View key={piece.id} className="flex-row items-center gap-3 rounded-card border border-dashed border-accent p-3">
          <ItemThumb category={piece.category ?? 'accessory'} className="h-14 w-12 rounded-[8px]" glyphSize={22} />
          <View className="flex-1 gap-0.5">
            <Text variant="eyebrow" tone="accent">
              {t('tripDetail.missingEyebrow')}
            </Text>
            <Text variant="body">{t('tripDetail.missingLine', { name: piece.name, reason: piece.reason })}</Text>
          </View>
        </View>
      ))}

      <DayLooks days={trip.days} />

      <View className="gap-3">
        <View className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <Text variant="h3">{t('tripDetail.listTitle')}</Text>
          {lookDays.length > 0 ? (
            <Button
              variant="text"
              icon={Sparkles}
              label={t('tripDetail.tryOnLooks')}
              onPress={() => {
                if (!online) {
                  setTryOnNote('offline');
                  return;
                }
                setTryOnNote(null);
                setConfirm(true);
              }}
            />
          ) : null}
        </View>
        {tryOnNote ? (
          <View className="flex-row items-center gap-1.5" accessibilityLiveRegion="polite">
            <Icon icon={CircleAlert} size={14} tone="danger" />
            <Text variant="caption" tone="danger" className="flex-1">
              {t(tryOnNote === 'offline' ? 'tripDetail.tryOnOffline' : 'tripDetail.tryOnFailed')}
            </Text>
          </View>
        ) : null}
        {groups.map((group) => (
          <View key={group.category} className="gap-0.5">
            <Text variant="caption" tone="muted">
              {t(`itemCategory.${group.category}`)}
            </Text>
            {group.items.map((item) => (
              <Pressable
                key={item.itemId}
                onPress={() => writes.setPacked(trip.id, item.itemId, !item.packed)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.packed }}
                accessibilityLabel={item.name}
                className="min-h-icon-btn flex-row items-center gap-3 active:opacity-70"
              >
                <View className={`h-6 w-6 items-center justify-center rounded-[6px] border ${item.packed ? 'border-ink bg-ink' : 'border-muted bg-paper'}`}>
                  {item.packed ? <Icon icon={Check} size={16} tone="paper" /> : null}
                </View>
                <Text variant="body" tone={item.packed ? 'muted' : 'ink'} className={`flex-1 ${item.packed ? 'line-through' : ''}`}>
                  {item.name}
                </Text>
              </Pressable>
            ))}
          </View>
        ))}
      </View>

      <CreditConfirmSheet
        visible={confirm}
        onClose={() => setConfirm(false)}
        cost={lookDays.length}
        scope={t('tripDetail.tryOnScopeTag')}
        onConfirm={startTryOn}
        confirming={tryOn.isStarting}
      />
    </>
  );
}

/**
 * 19 Bavul detayı — forecast, readiness ring, checklist (checked = struck through), daily looks,
 * missing pieces → "Eksikleri tamamla", cabin-only mode. A trip without an accepted list shows the
 * AI packing wait / draft instead.
 */
export default function TripDetailScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useTrip(id);
  const writes = useTripWrites();
  const [menu, setMenu] = useState(false);
  const data = trip.data;
  const showBar = data?.status === 'packed' && data.missing.length > 0;

  const confirmDelete = () => {
    Alert.alert(t('tripDetail.deleteTitle'), t('tripDetail.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('tripDetail.deleteConfirm'),
        style: 'destructive',
        onPress: () => {
          writes.remove(id);
          leave();
        },
      },
    ]);
  };

  return (
    <Screen bottom={!showBar}>
      <ScreenHeader
        leading="back"
        onLeadingPress={leave}
        right={data ? <IconButton icon={Ellipsis} variant="plain" onPress={() => setMenu(true)} accessibilityLabel={t('tripDetail.more')} /> : undefined}
      />
      <ScreenState query={trip} skeleton={<TripSkeleton />}>
        {(detail) => {
          const range = formatDateRange(parseLocalDate(detail.startDate), parseLocalDate(detail.endDate), { day: 'numeric', month: 'long' });
          const days = t('trips.days', { count: tripLengthDays(detail.startDate, detail.endDate) });
          return (
            <ScrollView contentContainerClassName="gap-5 px-gutter pb-8">
              <View className="gap-1">
                <Text variant="eyebrow">{toDisplayUpper(t('tripDetail.headerEyebrow', { range, days }), currentLanguage())}</Text>
                <Text variant="display" numberOfLines={2}>
                  {detail.cityName}
                </Text>
              </View>
              <Forecast trip={detail} />
              {detail.status === 'packed' ? <PackedTrip trip={detail} /> : <TripPacking trip={detail} />}
            </ScrollView>
          );
        }}
      </ScreenState>

      {showBar && data ? (
        <View className="flex-row items-center gap-4 border-t border-line bg-paper px-gutter pt-3" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
          <View className="flex-1 gap-0.5">
            <Text variant="bodyMedium" numberOfLines={1}>
              {t('tripDetail.missingCount', { count: data.missing.length })}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={2}>
              {t('tripDetail.missingNote')}
            </Text>
          </View>
          <Button label={t('tripDetail.completeMissing')} onPress={() => router.push({ pathname: '/shop', params: { tripId: data.id } })} />
        </View>
      ) : null}

      <PopoverMenu
        visible={menu}
        onClose={() => setMenu(false)}
        top={insets.top + 52}
        actions={[
          { key: 'edit', label: t('tripDetail.edit'), icon: Pencil, onPress: () => router.push({ pathname: '/trip/new', params: { id } }) },
          { key: 'delete', label: t('tripDetail.delete'), icon: Trash2, destructive: true, onPress: confirmDelete },
        ]}
      />
    </Screen>
  );
}
