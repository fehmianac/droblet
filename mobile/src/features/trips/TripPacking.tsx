import { router, useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { itemImageSource } from '@/api/imageSources';
import type { TripDetail } from '@/api/contracts/trips';
import { AiBackgroundAction, AiFailure } from '@/components/ui/ai/AiOutcome';
import { AiProgressLines } from '@/components/ui/ai/AiProgressLines';
import { AI_NEUTRAL_TONES, AiSwatchReveal, toneColor } from '@/components/ui/ai/AiReveal';
import { AiSkeletonRows } from '@/components/ui/ai/AiSkeletonCards';
import { InfoNote } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useTeenRules } from '@/features/teen/store';
import { TeenPackLock } from '@/features/teen/TeenStylist';
import { ItemThumb } from '@/features/wardrobe/ItemThumb';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { parseLocalDate, weekdayShort } from '@/lib/format';
import { ulid } from '@/lib/ids';
import { toDisplayUpper } from '@/lib/upper';
import { useIsOnline } from '@/sync/network';

import { usePackJob, useStartPack, useTripWrites } from './api';
import { packErrorState, tripDates, tripLengthDays, type PackErrorState } from './logic';

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
  // Canvas 18 · 16w: an approved teen whose packing is off (or used this week) never starts the job.
  const teenStylist = useTeenRules().stylist;
  const teenPackLocked = teenStylist !== null && teenStylist.pack !== 'open';

  // A job that failed and was retried must not flash its old failure while the new one starts.
  const jobActive = Boolean(trip.packJobId) && trip.packJobId !== dismissedJob;
  // The create write may still be queued (baseVersion 0 = not confirmed): the job can only start afterwards.
  const confirmed = trip.baseVersion > 0;
  const canAutoStart = confirmed && online && !jobActive && !start.isPending && !start.isError && dismissedJob === null && !teenPackLocked;
  const { mutate } = start;
  const tripId = trip.id;

  useEffect(() => {
    // Stable request id: starting twice (remount, double effect) opens one job. It must be a ULID
    // (400 `request_id_invalid` otherwise) — the trip id is one, and a trip's first pack is one job.
    if (canAutoStart) mutate({ requestId: tripId });
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
              <ItemThumb category={item.category} color={item.color} {...itemImageSource(item, 'thumb')} className="h-12 w-10 rounded-[8px]" glyphSize={20} />
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

  if (teenPackLocked && !jobActive) return <TeenPackLock />;

  if (start.isError || (jobActive && job.isFailed)) {
    const state = start.isError ? packErrorState(start.error) : packErrorState(job.error, job.errorCode);
    if (state === 'teenOff' || state === 'teenLimit') return <TeenPackLock state={state === 'teenOff' ? 'unavailable' : 'limitReached'} />;
    if (state === 'failed') return <AiFailure creditRefunded={false} onRetry={retry} retrying={start.isPending} layout="inline" />;
    return <PackBlocked state={state} onRetry={retry} retrying={start.isPending} />;
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

const BLOCKED_TEXT = {
  paywall: 'tripDetail.packPremium',
  consent: 'tripDetail.packConsent',
  wardrobe: 'tripDetail.packWardrobe',
} as const satisfies Record<Exclude<PackErrorState, 'failed' | 'teenOff' | 'teenLimit'>, string>;

/**
 * A pack start the server refused for a reason the user can act on: Premium (the paywall — and from there the
 * self-premium link when it is enabled — opened once by `routeAiStartError`, offered again here), a missing consent
 * (the consent sheet opened by the query client; "Try again" once it is given) or a wardrobe too small to dress a day.
 */
function PackBlocked({ state, onRetry, retrying }: { state: Exclude<PackErrorState, 'failed' | 'teenOff' | 'teenLimit'>; onRetry: () => void; retrying: boolean }) {
  const { t } = useTranslation();
  return (
    <View className="items-center gap-3 py-4" accessibilityLiveRegion="polite" testID={`pack-blocked-${state}`}>
      <Text variant="body" tone="muted" className="text-center">
        {t(BLOCKED_TEXT[state])}
      </Text>
      {state === 'paywall' ? (
        <Button label={t('tripDetail.packPremiumAction')} onPress={() => router.push({ pathname: '/paywall', params: { from: 'suitcase' } })} testID="pack-paywall" />
      ) : null}
      {state === 'wardrobe' ? <Button label={t('tripDetail.packWardrobeAction')} onPress={() => router.push('/item/add')} testID="pack-add-items" /> : null}
      <Button variant="secondary" label={t('ai.retry')} onPress={onRetry} loading={retrying} testID="pack-retry" />
    </View>
  );
}
