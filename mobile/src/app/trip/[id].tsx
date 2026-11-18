import { router, useLocalSearchParams } from 'expo-router';
import {
  Check,
  CircleAlert,
  Cloud,
  CloudRain,
  Ellipsis,
  MirrorRound,
  Pencil,
  Share as ShareIcon,
  Snowflake,
  Sun,
  Trash2,
  type LucideIcon,
} from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { TripDay, TripDetail, TripMissingPiece, WeatherCondition } from '@/api/contracts/trips';
import { ITEM_CATEGORIES } from '@/api/contracts/wardrobe';
import { PopoverMenu } from '@/components/ui/Bits';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { BottomSheet } from '@/components/ui/BottomSheet';
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
import { groupByCategory, readiness, tripLengthDays, tripShareText } from '@/features/trips/logic';
import { ReadinessRing } from '@/features/trips/ReadinessRing';
import { TripPacking } from '@/features/trips/TripPacking';
import { useStartTryOn } from '@/features/tryon/api';
import { ItemThumb } from '@/features/wardrobe/ItemThumb';
import { useItems } from '@/features/wardrobe/queries';
import { currentLanguage } from '@/i18n';
import { formatDateRange, formatTemperature, parseLocalDate, weekdayShort } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';
import { useIsOnline } from '@/sync/network';
import { placeholderTones } from '@/theme/tokens';

const WEATHER_ICON: Record<WeatherCondition, LucideIcon> = { sun: Sun, cloud: Cloud, rain: CloudRain, snow: Snowflake };

/** Up to a week the forecast cards share the row (canvas: five equal cards); longer trips scroll. */
const FORECAST_ROW_MAX = 7;

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/wardrobe/trips');
}

function TripSkeleton() {
  return (
    <View className="gap-3 px-gutter">
      <View className="gap-2">
        <Skeleton className="h-3 w-40 rounded-field" />
        <Skeleton className="h-9 w-1/2 rounded-field" />
      </View>
      <View className="flex-row gap-1.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[60px] flex-1 rounded-field" />
        ))}
      </View>
      <Skeleton className="h-[86px] w-full rounded-card" />
      <View className="flex-row gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[72px] w-16 rounded-thumb" />
        ))}
      </View>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-9 w-full rounded-field" />
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
  const fits = trip.forecast.length <= FORECAST_ROW_MAX;
  const cards = trip.forecast.map((day) => {
    const weekday = weekdayShort(parseLocalDate(day.date));
    const temperature = formatTemperature(day.temperatureC);
    return (
      <View
        key={day.date}
        accessible
        accessibilityLabel={t('tripDetail.forecastDay', { weekday, temperature, condition: t(`tripDetail.condition.${day.condition}`) })}
        className={`items-center gap-0.5 rounded-field border border-line bg-paper py-1.5 ${fits ? 'flex-1' : 'min-w-[58px] px-2'}`}
      >
        <Text variant="caption" tone="muted" numberOfLines={1} className="text-[11px]">
          {weekday}
        </Text>
        <Icon icon={WEATHER_ICON[day.condition]} size={18} />
        <Text variant="badge">{temperature}</Text>
      </View>
    );
  });
  if (fits) {
    return (
      <View className="flex-row gap-1.5" accessibilityLabel={t('tripDetail.forecastLabel')}>
        {cards}
      </View>
    );
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={t('tripDetail.forecastLabel')}
      className="-mx-gutter"
      contentContainerClassName="gap-1.5 px-gutter"
    >
      {cards}
    </ScrollView>
  );
}

/** Daily looks (19): 64 × 72 thumbnails with the weekday as the image tag ("SAL", "ÇAR" …). */
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
      contentContainerClassName="gap-2 px-gutter"
    >
      {planned.map((day) => {
        const ref = day.look;
        if (!ref) return null;
        const weekday = weekdayShort(parseLocalDate(day.date));
        const look = looks.data?.find((l) => l.id === ref.id);
        return (
          <Pressable
            key={day.date}
            onPress={() => router.push({ pathname: '/look/[id]', params: { id: ref.id } })}
            accessibilityRole="button"
            accessibilityLabel={t('tripDetail.dayLook', { weekday, name: ref.name })}
            className="active:opacity-80"
          >
            <LookCover
              seed={ref.id}
              figureHeight={46}
              tryOnImageUrl={ref.imageUrl}
              slots={look?.slots ?? []}
              itemsById={itemsById}
              className="h-[72px] w-16 rounded-thumb"
            >
              <View className="absolute bottom-1 left-1 rounded-tag bg-paper/90 px-1 py-0.5">
                <Text variant="tag" numberOfLines={1} className="text-[8.5px] leading-[11px]">
                  {toDisplayUpper(weekday, currentLanguage())}
                </Text>
              </View>
            </LookCover>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Square check mark of the canvas checklists (accent-colour ink when on). */
function CheckBox({ checked, size }: { checked: boolean; size: 18 | 20 }) {
  return (
    <View
      className={`items-center justify-center rounded-[4px] border ${checked ? 'border-ink bg-ink' : 'border-muted bg-paper'}`}
      style={{ width: size, height: size }}
    >
      {checked ? <Icon icon={Check} size={size - 6} tone="paper" /> : null}
    </View>
  );
}

function MissingCard({ piece }: { piece: TripMissingPiece }) {
  const { t } = useTranslation();
  const productId = piece.productId;
  const line = t('tripDetail.missingLine', { name: piece.name, reason: piece.reason });
  return (
    <Pressable
      onPress={productId ? () => router.push({ pathname: '/shop/product/[id]', params: { id: productId } }) : undefined}
      disabled={!productId}
      accessibilityRole={productId ? 'button' : undefined}
      accessibilityLabel={t('tripDetail.missingNoteLine', { name: piece.name, reason: piece.reason })}
      accessibilityHint={productId ? t('tripDetail.missingOpenHint') : undefined}
      className="flex-row items-center gap-2.5 rounded-card border border-accent bg-paper px-3 py-2.5 active:opacity-80"
    >
      <View className="overflow-hidden rounded-[8px] border-[1.5px] border-dashed" style={{ borderColor: placeholderTones.camel }}>
        <ItemThumb category={piece.category ?? 'accessory'} color="black" className="h-[41px] w-[37px]" glyphSize={20} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text variant="eyebrow" tone="accent">
          {t('tripDetail.missingEyebrow')}
        </Text>
        <Text variant="body" className="text-[13.5px]">
          {line}
        </Text>
      </View>
    </Pressable>
  );
}

function PackedTrip({ trip }: { trip: TripDetail }) {
  const { t } = useTranslation();
  const online = useIsOnline();
  const writes = useTripWrites();
  const tryOn = useStartTryOn();
  const [confirm, setConfirm] = useState(false);
  const [tryOnNote, setTryOnNote] = useState<'offline' | 'failed' | null>(null);

  const ready = readiness(trip.items);
  const lookDays = trip.days.filter((d) => d.look);
  const rows = groupByCategory(trip.items, ITEM_CATEGORIES).flatMap((group) => group.items);

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
      <View className="flex-row items-center gap-3 rounded-card border border-line bg-paper px-3.5 py-2.5">
        <View className="flex-1">
          <Text variant="bodyMedium">
            {t('tripDetail.summary', { pieces: t('trips.pieces', { count: trip.items.length }), looks: t('tripDetail.looks', { count: lookDays.length }) })}
          </Text>
          {trip.minWearsPerItem ? (
            <Text variant="caption" tone="muted">
              {t('tripDetail.minWears', { count: trip.minWearsPerItem })}
            </Text>
          ) : null}
          <Pressable
            onPress={() => writes.setCabinOnly(trip, !trip.cabinOnly)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: trip.cabinOnly }}
            accessibilityLabel={t('tripDetail.cabinOnly')}
            accessibilityHint={t('tripDetail.cabinOnlyHint')}
            hitSlop={{ top: 8, bottom: 8 }}
            testID="trip-cabin-only"
            className="mt-1.5 min-h-7 flex-row items-center gap-2 self-start active:opacity-70"
          >
            <CheckBox checked={trip.cabinOnly} size={18} />
            <Text variant="caption" className="text-[12.5px]">
              {t('tripDetail.cabinOnly')}
            </Text>
          </Pressable>
        </View>
        <ReadinessRing {...ready} />
      </View>

      {trip.missing.map((piece) => (
        <MissingCard key={piece.id} piece={piece} />
      ))}

      <DayLooks days={trip.days} />

      <View>
        <View className="flex-row flex-wrap items-center justify-between gap-x-3">
          <Text variant="h3">{t('tripDetail.listTitle')}</Text>
          {lookDays.length > 0 ? (
            <Pressable
              onPress={() => {
                if (!online) {
                  setTryOnNote('offline');
                  return;
                }
                setTryOnNote(null);
                setConfirm(true);
              }}
              accessibilityRole="button"
              accessibilityLabel={t('tripDetail.tryOnLooks')}
              testID="trip-try-on"
              className="min-h-icon-btn flex-row items-center gap-1 active:opacity-70"
            >
              <Icon icon={MirrorRound} size={15} />
              <Text variant="label">{t('tripDetail.tryOnLooks')}</Text>
            </Pressable>
          ) : null}
        </View>
        {tryOnNote ? (
          <View className="flex-row items-center gap-1.5 pb-2" accessibilityLiveRegion="polite">
            <Icon icon={CircleAlert} size={14} tone="danger" />
            <Text variant="caption" tone="danger" className="flex-1">
              {t(tryOnNote === 'offline' ? 'tripDetail.tryOnOffline' : 'tripDetail.tryOnFailed')}
            </Text>
          </View>
        ) : null}
        {rows.map((item) => (
          <Pressable
            key={item.itemId}
            onPress={() => writes.setPacked(trip.id, item.itemId, !item.packed)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.packed }}
            accessibilityLabel={item.name}
            accessibilityHint={t(`itemCategory.${item.category}`)}
            className="min-h-icon-btn flex-row items-center gap-3 border-b border-line py-2 active:opacity-70"
          >
            <CheckBox checked={item.packed} size={20} />
            <Text variant="body" tone={item.packed ? 'muted' : 'ink'} numberOfLines={2} className={`flex-1 ${item.packed ? 'line-through' : ''}`}>
              {item.name}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {t(`itemCategory.${item.category}`)}
            </Text>
          </Pressable>
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
 * 19 Bavul detayı — share, forecast, readiness ring, single-cabin-bag mode, missing pieces, daily looks
 * with weekday tags, the checklist (checked = struck through) and the bottom bar "Eksikleri tamamla".
 * A trip without an accepted list shows the AI packing wait / draft instead.
 */
export default function TripDetailScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useTrip(id);
  const writes = useTripWrites();
  const [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const data = trip.data;
  const packed = data?.status === 'packed';
  const showBar = Boolean(packed && data && data.missing.length > 0);

  const share = () => {
    if (!data) return;
    const range = formatDateRange(parseLocalDate(data.startDate), parseLocalDate(data.endDate), { day: 'numeric', month: 'long' });
    const message = tripShareText(data, {
      title: t('tripDetail.shareTitle', { city: data.cityName, range, days: t('trips.days', { count: tripLengthDays(data.startDate, data.endDate) }) }),
      listHeader: t('tripDetail.listTitle'),
      item: (name, isPacked) => t(isPacked ? 'tripDetail.shareItemPacked' : 'tripDetail.shareItem', { name }),
      looksHeader: t('tripDetail.dailyLooks'),
      look: (date, name) => t('tripDetail.dayLook', { weekday: weekdayShort(parseLocalDate(date)), name }),
      missingHeader: t('common.missingPiece'),
      missing: (name, reason) => t('tripDetail.missingLine', { name, reason }),
      footer: t('tripDetail.shareFooter'),
    });
    void Share.share({ message }).catch(() => undefined);
  };

  return (
    <Screen bottom={!showBar}>
      <ScreenHeader
        leading="back"
        onLeadingPress={leave}
        right={
          data ? (
            <>
              {packed ? <IconButton icon={ShareIcon} onPress={share} accessibilityLabel={t('tripDetail.share')} testID="trip-share" /> : null}
              <IconButton icon={Ellipsis} variant="plain" onPress={() => setMenu(true)} accessibilityLabel={t('tripDetail.more')} />
            </>
          ) : undefined
        }
      />
      <ScreenState query={trip} skeleton={<TripSkeleton />}>
        {(detail) => {
          const range = formatDateRange(parseLocalDate(detail.startDate), parseLocalDate(detail.endDate), { day: 'numeric', month: 'long' });
          const days = t('trips.days', { count: tripLengthDays(detail.startDate, detail.endDate) });
          return (
            <ScrollView contentContainerClassName="gap-3 px-gutter pb-8">
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
        <BottomActionBar>
          <View className="flex-row items-center gap-2.5">
            <View className="shrink">
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {t('tripDetail.missingCount', { count: data.missing.length })}
              </Text>
              <Text variant="title" numberOfLines={2}>
                {t('tripDetail.missingNote')}
              </Text>
            </View>
            <View className="flex-1">
              <Button
                label={t('tripDetail.completeMissing')}
                onPress={() => router.push({ pathname: '/shop', params: { tripId: data.id } })}
                testID="trip-complete-missing"
              />
            </View>
          </View>
        </BottomActionBar>
      ) : null}

      <PopoverMenu
        visible={menu}
        onClose={() => setMenu(false)}
        top={insets.top + 52}
        actions={[
          { key: 'edit', label: t('tripDetail.edit'), icon: Pencil, onPress: () => router.push({ pathname: '/trip/new', params: { id } }) },
          { key: 'delete', label: t('tripDetail.delete'), icon: Trash2, destructive: true, onPress: () => setDeleting(true) },
        ]}
      />

      <BottomSheet visible={deleting} onClose={() => setDeleting(false)} title={t('tripDetail.deleteTitle')}>
        <View className="gap-3.5">
          <Text variant="body" tone="muted">
            {t('tripDetail.deleteBody')}
          </Text>
          <Button
            variant="danger"
            label={t('tripDetail.delete')}
            testID="trip-delete-confirm"
            onPress={() => {
              setDeleting(false);
              writes.remove(id);
              leave();
            }}
          />
          <Button variant="secondary" size="lg" label={t('common.cancel')} onPress={() => setDeleting(false)} />
        </View>
      </BottomSheet>
    </Screen>
  );
}
