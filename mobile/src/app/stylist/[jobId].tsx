import { useQueryClient } from '@tanstack/react-query';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { Heart, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import type { Entitlement } from '@/api/contracts';
import { STYLIST_SUGGESTION_COUNT, type StylistOutfitRequest, type StylistOutfitResult } from '@/api/contracts/stylist';
import { AiBackgroundAction, AiDropPulse, AiFailure, AiProgressLines, AiSkeletonCards, AiSkeletonRows } from '@/components/ui/ai';
import { InfoNote } from '@/components/ui/Bits';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { StateMessage } from '@/components/ui/StateMessage';
import { Text } from '@/components/ui/Text';
import { CreditConfirmSheet } from '@/features/credits/CreditConfirmSheet';
import { aiCreditsKey, openCreditTopUp, useAiCredits } from '@/features/credits/useAiCredits';
import { stylistKeys, useAcceptSuggestion, useStartStylistOutfit, useStylistJob, useSuggestionFeedback, useSuggestionTryOns } from '@/features/stylist/api';
import { SuggestionMedia, type MediaMode } from '@/features/stylist/SuggestionMedia';
import { SuggestionPieces } from '@/features/stylist/SuggestionPieces';
import { CalendarSheet, FeedbackSheet } from '@/features/stylist/SuggestionSheets';
import { TRY_ON_CREDIT_COST, useStartTryOn, useTryOnJob } from '@/features/tryon/api';
import { formatDate, parseLocalDate, toIsoDate } from '@/lib/format';
import { useIsOnline } from '@/sync/network';

type Sheet = 'none' | 'feedback' | 'calendar' | 'credit';

/**
 * 17 Kombin önerisi. While the stylist job runs: the stilist wait (no spinner, no credits). Then the
 * three suggestions, one at a time: pieces (wardrobe / missing store piece → "Look'u tamamla"),
 * "Üzerimde gör" (1 credit, confirmed first; 17c while the image is generated; 17b when the month's
 * credits are gone), ✕ feedback, "Takvime ekle" and the lookbook heart. Nothing is saved without the
 * user's action. The job id is in the route, so reopening resumes the same job.
 */
export default function StylistResultScreen() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const params = useLocalSearchParams<{ jobId: string; title?: string }>();
  const jobId = params.jobId;
  const focused = useIsFocused();
  const online = useIsOnline();

  const stylist = useStylistJob(jobId, { enabled: focused });
  const restart = useStartStylistOutfit();
  const credits = useAiCredits();
  const tryOns = useSuggestionTryOns(jobId);
  const startTryOn = useStartTryOn();
  const accept = useAcceptSuggestion(jobId);
  const feedback = useSuggestionFeedback(jobId);

  const [current, setCurrent] = useState(0);
  const [dismissed, setDismissed] = useState<number[]>([]);
  const [skippedWait, setSkippedWait] = useState<number[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>('none');

  const tryOnJobId = tryOns.jobs[current] ?? null;
  const tryOn = useTryOnJob(tryOnJobId, { enabled: focused });
  const tryOnSettled = tryOn.isDone || tryOn.isFailed;
  useEffect(() => {
    // A finished image spent the credit; a failed one got it back — either way re-read the balance.
    if (tryOnSettled) void client.invalidateQueries({ queryKey: aiCreditsKey });
  }, [client, tryOnSettled]);

  const request = client.getQueryData<StylistOutfitRequest>(stylistKeys.request(jobId));
  const result: StylistOutfitResult | null = stylist.result;
  const occasion = result?.request.occasion ?? request?.occasion ?? null;
  const title = params.title || (occasion ? t(`occasion.${occasion}`) : (result?.request.text ?? request?.text)) || t('stylistHome.fallbackTitle');

  const askAgain = () => {
    const pending = restart.restart(jobId);
    if (!pending) {
      router.replace('/stylist');
      return;
    }
    void pending.then(({ jobId: next }) => router.replace({ pathname: '/stylist/[jobId]', params: { jobId: next, title } })).catch(() => undefined);
  };

  // ---------- waiting ----------
  if (stylist.isWorking) {
    const weather = client.getQueryData<{ city: string | null; days: { temperatureC: number }[] }>(
      stylistKeys.weather(request?.date ?? toIsoDate(new Date())),
    );
    const temperature = weather?.days[0]?.temperatureC;
    const lines = [
      t('ai.stylistLines.wardrobe'),
      temperature !== undefined ? t('ai.stylistLines.weather', { temperature: Math.round(temperature) }) : t('ai.stylistLines.weatherUnknown'),
      t('ai.stylistLines.outfits', { count: STYLIST_SUGGESTION_COUNT }),
    ];
    return (
      <Screen bottom>
        <ScreenHeader title={title} leading="close" />
        <OfflineBanner />
        <View className="flex-1 gap-6 px-gutter pt-6" accessibilityState={{ busy: true }}>
          <View className="items-center gap-4">
            <AiDropPulse height={61} />
            <View className="w-full">
              <AiProgressLines lines={lines} align="center" />
            </View>
            <Text variant="caption" tone="muted" className="text-center">
              {t('ai.noCreditForText')}
            </Text>
          </View>
          <AiSkeletonCards count={STYLIST_SUGGESTION_COUNT} />
          <AiSkeletonRows />
        </View>
        <View className="px-gutter pb-4">
          <AiBackgroundAction label={t('ai.showWhenReady')} onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  // ---------- failed / timed out ----------
  if (stylist.isFailed || !result) {
    return (
      <Screen bottom>
        <ScreenHeader title={title} leading="back" />
        <OfflineBanner />
        {/* Text suggestions never reserve a credit, so there is nothing to refund. */}
        <AiFailure creditRefunded={false} onRetry={askAgain} retrying={restart.isStarting} />
      </Screen>
    );
  }

  const suggestions = result.suggestions;
  const total = suggestions.length;
  if (total === 0) {
    return (
      <Screen bottom>
        <ScreenHeader title={title} leading="back" />
        <StateMessage message={t('stylistResult.empty')} actionLabel={t('stylistResult.askAgain')} onAction={() => router.replace('/stylist')} />
      </Screen>
    );
  }

  const remainingOnes = suggestions.filter((s) => !dismissed.includes(s.index));
  if (remainingOnes.length === 0) {
    return (
      <Screen bottom>
        <ScreenHeader title={title} leading="back" />
        <StateMessage message={t('stylistResult.allDismissedTitle')} actionLabel={t('stylistResult.askAgain')} onAction={askAgain} actionLoading={restart.isStarting} />
      </Screen>
    );
  }

  const suggestion = suggestions.find((s) => s.index === current && !dismissed.includes(s.index)) ?? remainingOnes[0];
  if (!suggestion) return null;
  const index = suggestion.index;
  const position = suggestions.findIndex((s) => s.index === index) + 1;

  // ---------- try-on state of the current suggestion ----------
  const hasImage = tryOn.isDone || Boolean(suggestion.tryOnImageUrl);
  const outOfCredits = credits.isMember && credits.remaining === 0;
  const mode: MediaMode = hasImage
    ? 'done'
    : tryOnJobId && tryOn.isFailed
      ? 'failed'
      : tryOnJobId
        ? 'working'
        : outOfCredits
          ? 'noCredits'
          : 'idle';
  const waiting = mode === 'working' && !skippedWait.includes(index);
  const cost = TRY_ON_CREDIT_COST;
  const creditLine =
    credits.remaining !== null
      ? t('stylistResult.creditLine', { count: cost, remaining: credits.remaining })
      : t('stylistResult.creditCostOnly', { count: cost });

  const entitlement = client.getQueryData<Entitlement>(aiCreditsKey);
  const noCreditsBody = entitlement?.credits.resetsAt
    ? t('stylistResult.noCreditsBody', { date: formatDate(new Date(entitlement.credits.resetsAt), { day: 'numeric', month: 'long' }) })
    : t('stylistResult.noCreditsBodyNoDate');

  const beginTryOn = () => {
    void startTryOn
      .start({ kind: 'suggestion', id: `${jobId}:${index}` })
      .then(({ jobId: started }) => {
        tryOns.set(index, started);
        setSkippedWait((prev) => prev.filter((i) => i !== index));
        setSheet('none');
      })
      .catch(() => setSheet('none'));
  };

  const goTo = (target: number) => {
    setCurrent(target);
    setNotice(null);
  };

  const submitFeedback = (reasons: Parameters<typeof feedback.send>[1], note: string) => {
    feedback.send(index, reasons, note);
    const nextDismissed = [...dismissed, index];
    setDismissed(nextDismissed);
    setSheet('none');
    setNotice(t('stylistResult.dismissed'));
    const next = suggestions.find((s) => s.index > index && !nextDismissed.includes(s.index)) ?? suggestions.find((s) => !nextDismissed.includes(s.index));
    if (next) setCurrent(next.index);
  };

  const addToCalendar = (date: string) => {
    accept.accept(index, date, suggestion.savedLookId);
    setSheet('none');
  };

  const saved = Boolean(suggestion.savedLookId);

  return (
    <Screen>
      <ScreenHeader title={title} leading="back" />
      <OfflineBanner />
      <ScrollView contentContainerClassName="gap-4 px-gutter pb-6 pt-1">
        {notice ? (
          <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
            {notice}
          </Text>
        ) : null}

        <SuggestionMedia
          suggestion={suggestion}
          mode={mode}
          imageUrl={tryOn.result?.imageUrl ?? suggestion.tryOnImageUrl}
          creditLine={creditLine}
          onTryOn={() => setSheet('credit')}
          tryOnDisabled={!online}
          creditRefunded={tryOn.creditRefunded}
          onRetry={() => {
            tryOns.set(index, null);
            setSheet('credit');
          }}
          retrying={startTryOn.isStarting}
          noCreditsBody={noCreditsBody}
          onTopUp={() => openCreditTopUp(true)}
        />

        <View className="flex-row items-end justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text variant="eyebrow">{t('stylistResult.counterEyebrow', { current: position, total })}</Text>
            <Text variant="h2">{suggestion.name}</Text>
          </View>
          <View className="flex-row items-center gap-1" accessibilityLabel={t('stylistResult.pagerA11y', { current: position, total })}>
            {suggestions.map((s, i) => {
              const skipped = dismissed.includes(s.index);
              const active = s.index === index;
              return (
                <IconDot
                  key={s.index}
                  active={active}
                  skipped={skipped}
                  label={t(skipped ? 'stylistResult.skippedA11y' : 'stylistResult.goTo', { current: i + 1 })}
                  onPress={() => goTo(s.index)}
                />
              );
            })}
          </View>
        </View>

        <Text variant="body" tone="muted">
          {suggestion.note}
        </Text>

        {waiting ? <AiSkeletonRows /> : <SuggestionPieces pieces={suggestion.pieces} suggestionId={`${jobId}:${index}`} />}

        {waiting ? <InfoNote text={t('ai.leaveHint')} /> : null}

        {mode === 'done' && credits.remaining !== null ? (
          <Text variant="caption" tone="muted">
            {t('stylistResult.creditUsed', { count: cost, remaining: credits.remaining })}
          </Text>
        ) : null}

        {suggestion.plannedDate ? (
          <View className="flex-row flex-wrap items-center gap-x-2 rounded-image-lg bg-sand px-3 py-1" accessibilityLiveRegion="polite">
            <Text variant="caption" className="flex-1">
              {t('stylistResult.planned', { date: formatDate(parseLocalDate(suggestion.plannedDate), { weekday: 'long', day: 'numeric', month: 'long' }) })}
            </Text>
            <Button variant="text" label={t('stylistResult.seeWeek')} onPress={() => router.push({ pathname: '/plan/week', params: { day: suggestion.plannedDate ?? '' } })} />
          </View>
        ) : null}
      </ScrollView>

      <BottomActionBar>
        {waiting ? (
          <Button variant="secondary" label={t('stylistResult.continueWithoutImage')} onPress={() => setSkippedWait((prev) => [...prev, index])} />
        ) : (
          <View className="flex-row items-center gap-3">
            <IconButton icon={X} onPress={() => setSheet('feedback')} accessibilityLabel={t('stylistResult.dislike')} />
            <View className="flex-1">
              <Button
                variant={mode === 'noCredits' ? 'secondary' : 'primary'}
                label={t('stylistResult.addToCalendar')}
                onPress={() => setSheet('calendar')}
                testID="add-to-calendar"
              />
            </View>
            <IconButton
              icon={Heart}
              active={saved}
              onPress={() => {
                if (!saved) accept.accept(index, null, null);
              }}
              accessibilityLabel={t(saved ? 'stylistResult.saved' : 'stylistResult.save')}
            />
          </View>
        )}
      </BottomActionBar>

      <FeedbackSheet visible={sheet === 'feedback'} onClose={() => setSheet('none')} onSubmit={submitFeedback} />
      <CalendarSheet visible={sheet === 'calendar'} onClose={() => setSheet('none')} requestDate={result.request.date} onConfirm={addToCalendar} />
      <CreditConfirmSheet visible={sheet === 'credit'} onClose={() => setSheet('none')} cost={cost} onConfirm={beginTryOn} confirming={startTryOn.isStarting} />
    </Screen>
  );
}

function IconDot({ active, skipped, label, onPress }: { active: boolean; skipped: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={skipped}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled: skipped }}
      className="h-icon-btn min-w-6 items-center justify-center"
    >
      <View className={`h-2 rounded-pill ${active ? 'w-5 bg-ink' : skipped ? 'w-2 bg-line' : 'w-2 bg-muted'}`} />
    </Pressable>
  );
}
