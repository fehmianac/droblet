import { router } from 'expo-router';
import { ChevronRight, Luggage } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import type { Trip } from '@/api/contracts/trips';
import { extractApiError } from '@/api/errors';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useTrips, useTripWrites } from '@/features/trips/api';
import { todayIso } from '@/features/trips/DateRangePicker';
import { splitTrips, tripLengthDays } from '@/features/trips/logic';
import { TripForm } from '@/features/trips/TripForm';
import { WardrobeHeader } from '@/features/wardrobe/WardrobeHeader';
import { formatDate, formatDateRange, parseLocalDate } from '@/lib/format';
import { useIsOnline } from '@/sync/network';
import { useThemeColors } from '@/theme/useThemeColors';

function TripRow({ trip, past }: { trip: Trip; past: boolean }) {
  const { t } = useTranslation();
  const start = parseLocalDate(trip.startDate);
  const days = t('trips.days', { count: tripLengthDays(trip.startDate, trip.endDate) });
  const pieces = t('trips.pieces', { count: trip.itemCount });
  const meta = past
    ? t('trips.pastMeta', { month: formatDate(start, { month: 'long' }), days, pieces })
    : trip.status === 'packed'
      ? t('trips.upcomingMeta', { range: formatDateRange(start, parseLocalDate(trip.endDate)), days, pieces })
      : t('trips.upcomingMetaNew', { range: formatDateRange(start, parseLocalDate(trip.endDate)), days });
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/trip/[id]', params: { id: trip.id } })}
      accessibilityRole="button"
      accessibilityLabel={t('trips.rowLabel', { city: trip.cityName, meta })}
      className="min-h-[76px] flex-row items-center gap-3 rounded-card border border-line bg-paper p-3 active:opacity-80"
    >
      <View className="h-14 w-12 items-center justify-center rounded-[8px] bg-sand">
        <Icon icon={Luggage} tone="muted" />
      </View>
      <View className="flex-1 gap-0.5">
        <Text variant="bodyMedium" numberOfLines={1}>
          {trip.cityName}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={2}>
          {meta}
        </Text>
      </View>
      <Icon icon={ChevronRight} size={18} tone="muted" />
    </Pressable>
  );
}

/**
 * 18 Bavullar — the "Yeni bavul" form (city autocomplete, dates, trip type, cabin-only) stays usable
 * in every list state; below it upcoming and past trips with their own loading / empty / error /
 * offline states.
 */
export default function WardrobeTripsScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const online = useIsOnline();
  const trips = useTrips();
  const writes = useTripWrites();
  const today = todayIso();

  let list;
  if (trips.data !== undefined) {
    const { upcoming, past } = splitTrips(trips.data, today);
    list =
      trips.data.length === 0 ? (
        <Text variant="body" tone="muted" className="py-2 text-center">
          {t('trips.empty')}
        </Text>
      ) : (
        <>
          {upcoming.length > 0 ? (
            <View className="gap-2.5">
              <Text variant="eyebrow">{t('trips.upcomingEyebrow')}</Text>
              {upcoming.map((trip) => (
                <TripRow key={trip.id} trip={trip} past={false} />
              ))}
            </View>
          ) : null}
          {past.length > 0 ? (
            <View className="gap-2.5">
              <Text variant="eyebrow">{t('trips.pastEyebrow')}</Text>
              {past.map((trip) => (
                <TripRow key={trip.id} trip={trip} past />
              ))}
            </View>
          ) : null}
        </>
      );
  } else if (trips.status === 'error') {
    list = (
      <View className="items-center gap-3 py-4">
        <Text variant="body" tone="muted" className="text-center">
          {t(`errors.${extractApiError(trips.error)}`)}
        </Text>
        <Button variant="secondary" label={t('common.retry')} onPress={() => void trips.refetch()} loading={trips.isRefetching} />
      </View>
    );
  } else if (!online || trips.fetchStatus === 'paused') {
    list = (
      <View className="items-center gap-3 py-4">
        <Text variant="body" tone="muted" className="text-center">
          {t('states.offlineNoCache')}
        </Text>
        <Button variant="secondary" label={t('common.retry')} onPress={() => void trips.refetch()} />
      </View>
    );
  } else {
    list = (
      <View className="gap-2.5" accessible accessibilityLabel={t('a11y.loading')}>
        <Skeleton className="h-3 w-40 rounded-field" />
        <Skeleton className="h-[76px] w-full rounded-card" />
        <Skeleton className="h-[76px] w-full rounded-card" />
      </View>
    );
  }

  return (
    <>
      <WardrobeHeader current="trips" eyebrow={t('trips.eyebrow')} title={t('trips.title')} />
      <OfflineBanner />
      <ScrollView
        contentContainerClassName="gap-6 px-gutter pb-8 pt-2"
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={trips.isRefetching} onRefresh={() => void trips.refetch()} tintColor={colors.muted} />}
      >
        <View className="gap-4 rounded-card border border-line bg-paper p-4">
          <Text variant="h3">{t('trips.newTitle')}</Text>
          <TripForm
            submitLabel={t('tripNew.submit')}
            onSubmit={(draft) => {
              const id = writes.create(draft);
              router.push({ pathname: '/trip/[id]', params: { id } });
            }}
          />
        </View>
        {list}
      </ScrollView>
    </>
  );
}
