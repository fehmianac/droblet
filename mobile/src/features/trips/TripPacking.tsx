import { router, useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { TripDetail } from '@/api/contracts/trips';
import { AiBackgroundAction, AiFailure } from '@/components/ui/ai/AiOutcome';
import { AiProgressLines } from '@/components/ui/ai/AiProgressLines';
import { AI_NEUTRAL_TONES, AiSwatchReveal, toneColor } from '@/components/ui/ai/AiReveal';
import { AiSkeletonRows } from '@/components/ui/ai/AiSkeletonCards';
import { InfoNote } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { ItemThumb } from '@/features/wardrobe/ItemThumb';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { parseLocalDate, weekdayShort } from '@/lib/format';
import { ulid } from '@/lib/ids';
import { toDisplayUpper } from '@/lib/upper';
import { useIsOnline } from '@/sync/network';

import { usePackJob, useStartPack, useTripWrites } from './api';
import { tripDates, tripLengthDays } from './logic';

const MAX_DAY_BOXES = 7;

/**
 * AI packing for a trip without an accepted list (19): starts the `trip-pack` job once the trip
 * exists on the server, waits in the AI loading language (day boxes, progress sentences, skeleton
 * rows — no spinner), then shows the result as a draft the user accepts. The job id lives in the
 * trip, so reopening the screen resumes the same job.
 */
export function TripPacking({ trip }: { trip: TripDetail }) {
  const language = useAppLanguage();
  const { t } = useTranslation();
  const online = useIsOnline();
  const focused = useIsFocused();
  const start = useStartPack(trip.id);
  const writes = useTripWrites();
  const job = usePackJob(trip.packJobId, { enabled: focused });
  const [dismissedJob, setDismissedJob] = useState<string | null>(null);

  // A job that failed and was retried must not flash its old failure while the new one starts.
  const jobActive = Boolean(trip.packJobId) && trip.packJobId !== dismissedJob;
  // The create write may still be queued (baseVersion 0 = not confirmed): the job can only start afterwards.
  const confirmed = trip.baseVersion > 0;
  const canAutoStart = confirmed && online && !jobActive && !start.isPending && !start.isError && dismissedJob === null;
  const { mutate } = start;
  const tripId = trip.id;

  useEffect(() => {
    // Stable request id: starting twice (remount, double effect) opens one job.
    if (canAutoStart) mutate({ requestId: `pack_${tripId}` });
  }, [canAutoStart, mutate, tripId]);

  const retry = () => {
    setDismissedJob(trip.packJobId ?? '');
    start.reset();
    mutate({ requestId: ulid() });
  };

  const days = tripLengthDays(trip.startDate, trip.endDate);
  const dates = tripDates(trip.startDate, trip.endDate).slice(0, MAX_DAY_BOXES);

  if (jobActive && job.isDone && job.result && trip.packJobId) {
    const plan = job.result;
    const jobId = trip.packJobId;
    return (
      <View className="gap-4">
        <View className="gap-1.5">
          <Text variant="eyebrow">{t('tripDetail.draftEyebrow')}</Text>
          <Text variant="h3">{t('tripDetail.summary', { pieces: t('trips.pieces', { count: plan.items.length }), looks: t('tripDetail.looks', { count: plan.days.filter((d) => d.look).length }) })}</Text>
          <Text variant="body" tone="muted">
            {t('tripDetail.draftBody')}
          </Text>
        </View>
        <View className="gap-2">
          {plan.items.map((item) => (
            <View key={item.itemId} className="flex-row items-center gap-3">
              <ItemThumb category={item.category} color={item.color} uri={item.imageUrl} className="h-12 w-10 rounded-[8px]" glyphSize={20} />
              <Text variant="body" numberOfLines={1} className="flex-1">
                {item.name}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {t(`itemCategory.${item.category}`)}
              </Text>
            </View>
          ))}
        </View>
        {plan.missing.map((m) => (
          <InfoNote key={m.id} text={t('tripDetail.missingNoteLine', { name: m.name, reason: m.reason })} />
        ))}
        <View className="gap-2">
          <Button label={t('tripDetail.acceptDraft')} onPress={() => writes.acceptPack(trip.id, jobId, plan)} testID="pack-accept" />
          <Button variant="secondary" label={t('tripDetail.regenerate')} onPress={retry} disabled={!online} />
        </View>
      </View>
    );
  }

  if (start.isError || (jobActive && job.isFailed)) {
    return <AiFailure creditRefunded={false} onRetry={retry} retrying={start.isPending} layout="inline" />;
  }

  if (!online && !jobActive) {
    return (
      <View className="items-center gap-3 py-4" accessibilityLiveRegion="polite">
        <Text variant="body" tone="muted" className="text-center">
          {t('tripDetail.packOffline')}
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-4" accessibilityState={{ busy: true }}>
      <Text variant="bodyMedium">{t('tripDetail.packingTitle', { city: trip.cityName, days: t('trips.days', { count: days }) })}</Text>
      <View className="gap-1.5">
        <AiSwatchReveal preset="day" colors={dates.map((_, i) => toneColor(AI_NEUTRAL_TONES[i % AI_NEUTRAL_TONES.length] ?? 'taupe'))} />
        <View className="flex-row gap-2" accessible={false} importantForAccessibility="no-hide-descendants">
          {dates.map((date) => (
            <Text key={date} variant="caption" tone="muted" numberOfLines={1} className="flex-1 text-center" maxFontSizeMultiplier={1.2}>
              {toDisplayUpper(weekdayShort(parseLocalDate(date)), language)}
            </Text>
          ))}
        </View>
      </View>
      <AiProgressLines
        lines={[
          t('tripDetail.packLines.wardrobe'),
          t('tripDetail.packLines.weather'),
          t('tripDetail.packLines.days'),
          t('tripDetail.packLines.list'),
        ]}
      />
      <AiSkeletonRows count={3} />
      <Text variant="caption" tone="muted">
        {t('tripDetail.packNote')}
      </Text>
      <AiBackgroundAction onPress={() => (router.canGoBack() ? router.back() : router.replace('/wardrobe/trips'))} />
    </View>
  );
}
