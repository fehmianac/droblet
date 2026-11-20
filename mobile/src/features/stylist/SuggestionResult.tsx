import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import { Bell, Check, Heart, Share as ShareIcon, X, type LucideIcon } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  Share,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';

import type { Entitlement } from '@/api/contracts';
import type { Job } from '@/api/contracts/jobs';
import type { StylistDislikeReason, StylistOutfitResult, StylistSuggestion } from '@/api/contracts/stylist';
import type { TryOnResult } from '@/api/contracts/tryon';
import { jobQueryKey } from '@/api/jobs';
import { InfoNote } from '@/components/ui/Bits';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { StateMessage } from '@/components/ui/StateMessage';
import { Text } from '@/components/ui/Text';
import { CreditConfirmSheet } from '@/features/credits/CreditConfirmSheet';
import { aiCreditsKey, openCreditTopUp, useAiCredits } from '@/features/credits/useAiCredits';
import { RequirementHint } from '@/features/requirements/RequirementHint';
import { useGate } from '@/features/requirements/useRequirements';
import { ensureTryOnConsent, TRY_ON_CREDIT_COST, useStartTryOn, useTryOnJob } from '@/features/tryon/api';
import { CachedTryOnNote, isCachedTryOnJob, useCachedTryOn } from '@/features/tryon/cached';
import { useTryOnInviteFooter } from '@/features/tryon/TryOnInvite';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { formatDate, parseLocalDate } from '@/lib/format';
import { useIsOnline } from '@/sync/network';

import { useSuggestionFeedback, useSuggestionTryOns } from './api';
import { NoCreditsCard, SuggestionMedia, type MediaMode } from './SuggestionMedia';
import { GapFillBanner } from './gapFill';
import { SuggestionPieces } from './SuggestionPieces';
import { CalendarSheet, FeedbackSheet, PlannedSheet } from './SuggestionSheets';
import { shortDay, useSuggestionActions } from './suggestionActions';
import { HeartPop } from './HeartPop';

type Sheet = 'none' | 'feedback' | 'calendar' | 'planned' | 'credit';

/** A horizontal drag this long (and clearly more horizontal than vertical) turns the page when paging does not animate. */
const SWIPE_MIN_DX = 48;

/** Neighbour of `from` among the suggestions that are still open; wraps round. Null when there is no other one. */
export function neighbourSuggestion(order: readonly number[], from: number, step: 1 | -1): number | null {
  if (order.length < 2) return null;
  const at = order.indexOf(from);
  if (at < 0) return order[0] ?? null;
  return order[(at + step + order.length) % order.length] ?? null;
}

/** What "Paylaş" sends: the occasion, the suggestion's name, the stylist's note and the pieces — text only, no image. */
export function suggestionShareMessage(
  t: TFunction,
  title: string,
  suggestion: Pick<StylistSuggestion, 'name' | 'note' | 'pieces'>,
): string {
  return t('stylistResult.shareMessage', {
    title,
    name: suggestion.name,
    note: suggestion.note,
    pieces: suggestion.pieces.map((p) => p.name).join(' · '),
  });
}

type Props = {
  jobId: string;
  title: string;
  result: StylistOutfitResult;
  /** Polling follows the screen focus. */
  focused: boolean;
  onAskAgain: () => void;
  askingAgain: boolean;
};

/**
 * 17 Kombin önerisi, once the suggestions are there. One suggestion per page: swipe sideways (or use
 * the dots) to move between the three; the dots stay in place and follow the page. Per suggestion:
 * the "on you" slot (17c while the image is generated, 17b when the month's credits are gone), the
 * piece rows ("Gardırobun" ✓ / "Eksik parça" → "Look'u tamamla"), and in the bottom bar ✕ feedback,
 * "Takvime ekle" and the lookbook heart. "Paylaş" in the header shares the open suggestion as text.
 * Nothing is saved without the user's action. With reduce-motion a page change never animates.
 */
export function SuggestionResult({ jobId, title, result, focused, onAskAgain, askingAgain }: Props) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const online = useIsOnline();
  const reduceMotion = useReduceMotion();
  const { width } = useWindowDimensions();

  const credits = useAiCredits();
  const tryOns = useSuggestionTryOns(jobId);
  const startTryOn = useStartTryOn();
  const feedback = useSuggestionFeedback(jobId);
  const actions = useSuggestionActions(jobId, result);

  const [current, setCurrent] = useState(0);
  const [dismissed, setDismissed] = useState<number[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>('none');
  // Missing photo / consent / membership: the requirements flow, which then opens the credit confirmation (canvas 11).
  const tryOnGate = useGate('tryOn', () => void ensureTryOnConsent().then((ok) => ok && setSheet('credit')), { origin: title });
  // The invitation tile says what a tap does: the cost, or the missing photo / membership.
  const invite = useTryOnInviteFooter(tryOnGate.req);
  const [titleTops, setTitleTops] = useState<Record<number, number>>({});

  const suggestions = result.suggestions;
  const open = suggestions.filter((s) => !dismissed.includes(s.index));
  const suggestion = open.find((s) => s.index === current) ?? open[0] ?? null;
  const index = suggestion?.index ?? -1;
  const page = Math.max(0, open.findIndex((s) => s.index === index));

  const tryOnJobId = index >= 0 ? (tryOns.jobs[index] ?? null) : null;
  const tryOn = useTryOnJob(tryOnJobId, { enabled: focused });
  const tryOnSettled = tryOn.isDone || tryOn.isFailed;
  // 13d: an image that already exists for this outfit + photo opens without the credit sheet (checked on open).
  const openSuggestion = index >= 0 ? (suggestions.find((s) => s.index === index) ?? null) : null;
  const cachedTryOn = useCachedTryOn(index >= 0 ? { kind: 'suggestion', id: `${jobId}:${index}` } : null, {
    enabled: focused && !tryOnJobId && !openSuggestion?.tryOnImageUrl,
  });
  useEffect(() => {
    // A finished image spent the credit; a failed one got it back — either way re-read the balance.
    if (tryOnSettled) void client.invalidateQueries({ queryKey: aiCreditsKey });
  }, [client, tryOnSettled]);

  // Keep the pager on the open suggestion when the page list or the width changes (a dismissed page disappears).
  const pager = useRef<ScrollViewInstance>(null);
  const pageRef = useRef(page);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);
  const openCount = open.length;
  useEffect(() => {
    pager.current?.scrollTo({ x: pageRef.current * width, animated: false });
  }, [openCount, width]);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  if (suggestions.length === 0) {
    return (
      <Screen bottom>
        <ScreenHeader title={title} leading="back" />
        <StateMessage message={t('stylistResult.empty')} actionLabel={t('stylistResult.askAgain')} onAction={() => router.replace('/stylist')} />
      </Screen>
    );
  }
  if (!suggestion) {
    return (
      <Screen bottom>
        <ScreenHeader title={title} leading="back" />
        <StateMessage message={t('stylistResult.allDismissedTitle')} actionLabel={t('stylistResult.askAgain')} onAction={onAskAgain} actionLoading={askingAgain} />
      </Screen>
    );
  }

  const total = suggestions.length;
  const position = suggestions.findIndex((s) => s.index === index) + 1;
  const cost = TRY_ON_CREDIT_COST;
  const outOfCredits = credits.isMember && credits.remaining === 0;
  const creditLine =
    credits.remaining !== null
      ? t('stylistResult.creditLine', { count: cost, remaining: credits.remaining })
      : t('stylistResult.creditCostOnly', { count: cost });
  const entitlement = client.getQueryData<Entitlement>(aiCreditsKey);
  const noCreditsBody = entitlement?.credits.resetsAt
    ? t('stylistResult.noCreditsBody', { date: formatDate(new Date(entitlement.credits.resetsAt), { day: 'numeric', month: 'long' }) })
    : t('stylistResult.noCreditsBodyNoDate');

  /** Try-on state of a page. The open page is polled; the others read what the job cache already knows. */
  const mediaOf = (s: StylistSuggestion): { mode: MediaMode; imageUrl: string | null; tryOnId: string | null; creditRefunded: boolean; cached: boolean } => {
    const id = tryOns.jobs[s.index] ?? null;
    const live = s.index === index;
    const cached = id && !live ? client.getQueryData<Job<TryOnResult>>(jobQueryKey(id)) : undefined;
    const done = live ? tryOn.isDone : cached?.status === 'done';
    const failed = live ? tryOn.isFailed : cached?.status === 'failed';
    const result = live ? tryOn.result : cached?.result;
    const imageUrl = result?.imageUrl ?? s.tryOnImageUrl;
    const tryOnId = result?.imageUrl ? (result.tryOnId ?? null) : null;
    const mode: MediaMode = done || s.tryOnImageUrl ? 'done' : id && failed ? 'failed' : id ? 'working' : outOfCredits ? 'noCredits' : 'idle';
    return { mode, imageUrl, tryOnId, creditRefunded: live ? tryOn.creditRefunded : (cached?.error?.creditRefunded ?? false), cached: isCachedTryOnJob(id) };
  };

  const mode = mediaOf(suggestion).mode;

  const select = (target: number) => {
    if (target === index) return;
    setCurrent(target);
    setNotice(null);
  };

  /** Dots / accessibility actions / the reduce-motion swipe: jump to a suggestion; animated only when motion is allowed. */
  const goTo = (target: number | null) => {
    if (target === null) return;
    const targetPage = open.findIndex((s) => s.index === target);
    if (targetPage < 0) return;
    select(target);
    pager.current?.scrollTo({ x: targetPage * width, animated: !reduceMotion });
  };
  const order = open.map((s) => s.index);
  const step = (direction: 1 | -1) => goTo(neighbourSuggestion(order, index, direction));

  const onPagerScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) return;
    const visible = open[Math.round(e.nativeEvent.contentOffset.x / width)];
    if (visible) select(visible.index);
  };

  // With reduce-motion the pager does not scroll under the finger; a sideways drag still turns the page, at once.
  const onTouchStart = (e: GestureResponderEvent) => {
    touchStart.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
  };
  const onTouchEnd = (e: GestureResponderEvent) => {
    const from = touchStart.current;
    touchStart.current = null;
    if (!reduceMotion || !from) return;
    const dx = e.nativeEvent.pageX - from.x;
    const dy = e.nativeEvent.pageY - from.y;
    if (Math.abs(dx) < SWIPE_MIN_DX || Math.abs(dx) < Math.abs(dy) * 2) return;
    const next = open[page + (dx < 0 ? 1 : -1)];
    if (next) goTo(next.index);
  };

  const beginTryOn = () => {
    void startTryOn
      .start({ kind: 'suggestion', id: `${jobId}:${index}` })
      .then(({ jobId: started }) => {
        tryOns.set(index, started);
        setSheet('none');
      })
      .catch(() => setSheet('none'));
  };

  const submitFeedback = (reasons: StylistDislikeReason[], note: string) => {
    feedback.send(index, reasons, note);
    const nextDismissed = [...dismissed, index];
    setDismissed(nextDismissed);
    setSheet('none');
    setNotice(t('stylistResult.dismissed'));
    const next = suggestions.find((s) => s.index > index && !nextDismissed.includes(s.index)) ?? suggestions.find((s) => !nextDismissed.includes(s.index));
    if (next) setCurrent(next.index);
  };

  /** "Üzerimde gör": an existing image opens at once (no sheet, no credit); otherwise the gate → consent → credit sheet. */
  const onTryOn = () => {
    if (cachedTryOn.cachedJobId) tryOns.set(index, cachedTryOn.cachedJobId);
    else tryOnGate.run();
  };

  const addToCalendar = (date: string) => {
    setSheet('none');
    actions.addToCalendar(suggestion, date);
  };

  const share = () => {
    // The system sheet reports a dismissal by itself; a failure to open it is not worth an error state.
    void Share.share({ message: suggestionShareMessage(t, title, suggestion) }).catch(() => undefined);
  };

  const saved = Boolean(suggestion.savedLookId);
  // Until the title row is measured: where it sits under the 200 : 264 slot of a (width − 40)-wide row.
  const estimatedTitleTop = 4 + ((width - 50) * (10 / 17) * 264) / 200 + 12;
  const dotsTop = (titleTops[index] ?? estimatedTitleTop) - 13;

  return (
    <Screen>
      <ScreenHeader
        title={title}
        leading="back"
        right={<IconButton icon={ShareIcon} iconSize={19} onPress={share} accessibilityLabel={t('stylistResult.share')} testID="share-suggestion" />}
      />
      <ScrollView contentContainerClassName="pb-6">
        {notice ? (
          <Text variant="caption" tone="muted" accessibilityLiveRegion="polite" className="px-gutter pb-2 pt-1">
            {notice}
          </Text>
        ) : null}

        <View onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} testID="suggestion-swipe">
          <ScrollView
            ref={pager}
            horizontal
            pagingEnabled
            scrollEnabled={!reduceMotion}
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={onPagerScroll}
            testID="suggestion-pager"
          >
            {open.map((s) => {
              const media = mediaOf(s);
              const live = s.index === index;
              // Text first: while the try-on image renders, only the image slot speaks the AI loading language (17c);
              // the pieces, the note and every action stay usable.
              const pageWaiting = media.mode === 'working';
              const pagePosition = suggestions.findIndex((x) => x.index === s.index) + 1;
              return (
                <View
                  key={s.index}
                  style={{ width }}
                  className="gap-3 px-gutter pt-1"
                  // Pages beside the open one are reached by swiping or the dots; screen readers read one suggestion at a time.
                  accessibilityElementsHidden={!live}
                  importantForAccessibility={live ? 'auto' : 'no-hide-descendants'}
                >
                  <SuggestionMedia
                    suggestion={s}
                    mode={media.mode}
                    imageUrl={media.imageUrl}
                    tryOnId={media.tryOnId}
                    creditLine={creditLine}
                    invite={invite}
                    onTryOn={onTryOn}
                    tryOnDisabled={!online}
                    creditRefunded={media.creditRefunded}
                    onRetry={() => {
                      tryOns.set(s.index, null);
                      tryOnGate.run();
                    }}
                    retrying={startTryOn.isStarting}
                  />

                  <View
                    className="gap-1 pr-14"
                    onLayout={(e) => {
                      const y = e.nativeEvent.layout.y;
                      setTitleTops((prev) => (prev[s.index] === y ? prev : { ...prev, [s.index]: y }));
                    }}
                  >
                    <Text variant="eyebrow">{t('stylistResult.counterEyebrow', { current: pagePosition, total })}</Text>
                    <Text variant="h2">{s.name}</Text>
                  </View>

                  {media.mode === 'noCredits' ? <NoCreditsCard body={noCreditsBody} onTopUp={() => openCreditTopUp(true)} /> : null}

                  <Text variant="body" tone="muted" className="text-[13.5px]">
                    {s.note}
                  </Text>

                  {live && tryOnGate.hint && media.mode === 'idle' ? <RequirementHint hint={tryOnGate.hint} onPress={tryOnGate.run} className="self-start" testID="suggestion-try-on-hint" /> : null}

                  {result.gapFilled && s.pieces.some((p) => p.suggested) ? (
                    <GapFillBanner libraryItemIds={s.pieces.filter((p) => p.source === 'library').map((p) => p.refId)} testID={`gapfill.banner.${s.index}`} />
                  ) : null}

                  <SuggestionPieces pieces={s.pieces} />

                  {pageWaiting ? <InfoNote icon={Bell} text={t('ai.leaveHint')} /> : null}

                  {media.mode === 'done' && media.cached ? (
                    <CachedTryOnNote />
                  ) : media.mode === 'done' && credits.remaining !== null ? (
                    <Text variant="caption" tone="muted">
                      {t('stylistResult.creditUsed', { count: cost, remaining: credits.remaining })}
                    </Text>
                  ) : null}

                  {s.plannedDate ? (
                    <View className="flex-row flex-wrap items-center gap-x-2 rounded-image-lg bg-sand px-3 py-1" accessibilityLiveRegion="polite">
                      <Text variant="caption" className="flex-1">
                        {t('stylistResult.planned', { date: formatDate(parseLocalDate(s.plannedDate), { weekday: 'long', day: 'numeric', month: 'long' }) })}
                      </Text>
                      <Button variant="text" label={t('stylistResult.seeWeek')} onPress={() => router.push({ pathname: '/plan/week', params: { day: s.plannedDate ?? '' } })} />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>

          {/* The dots do not travel with the page: one control, right of the title row (16 × 6 active, 6 × 6 idle, 4 apart). */}
          <Pressable
            onPress={() => step(1)}
            disabled={open.length < 2}
            accessibilityRole="adjustable"
            accessibilityLabel={t('stylistResult.pagerA11y', { current: position, total })}
            accessibilityHint={open.length > 1 ? t('stylistResult.pagerHint') : undefined}
            accessibilityValue={{ min: 1, max: total, now: position }}
            accessibilityActions={[
              { name: 'increment', label: t('stylistResult.next') },
              { name: 'decrement', label: t('stylistResult.previous') },
            ]}
            onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'decrement' ? -1 : 1)}
            hitSlop={{ left: 12, right: 12 }}
            testID="suggestion-dots"
            className="absolute right-gutter h-icon-btn flex-row items-center gap-1"
            style={{ top: dotsTop }}
          >
            {suggestions.map((s) => (
              <View
                key={s.index}
                className={`h-1.5 rounded-[3px] ${s.index === index ? 'w-4 bg-ink' : dismissed.includes(s.index) ? 'w-1.5 bg-line' : 'w-1.5 bg-ink/20'}`}
              />
            ))}
          </Pressable>
        </View>
      </ScrollView>

      <BottomActionBar>
        <View className="flex-row items-center gap-2.5">
          <BarRoundButton icon={X} onPress={() => setSheet('feedback')} accessibilityLabel={t('stylistResult.dislike')} />
          <View className="flex-1">
            {suggestion.plannedDate ? (
              // 13c B: added — "✓ Takvimde · Sal 24 Kas"; tapping offers change day / remove.
              <Button
                variant="secondary"
                size="lg"
                icon={Check}
                label={t('stylistResult.inCalendar', { date: shortDay(suggestion.plannedDate) })}
                onPress={() => setSheet('planned')}
                testID="in-calendar"
              />
            ) : (
              <Button
                variant={mode === 'noCredits' ? 'secondary' : 'primary'}
                size="lg"
                label={t('stylistResult.addToCalendar')}
                onPress={() => setSheet('calendar')}
                testID="add-to-calendar"
              />
            )}
          </View>
          <BarRoundButton
            icon={Heart}
            active={saved}
            pop={!reduceMotion}
            onPress={() => (saved ? actions.unsave(suggestion) : actions.save(suggestion))}
            accessibilityLabel={t(saved ? 'stylistResult.unsave' : 'stylistResult.save')}
            testID="save-suggestion"
          />
        </View>
      </BottomActionBar>

      <FeedbackSheet visible={sheet === 'feedback'} onClose={() => setSheet('none')} onSubmit={submitFeedback} />
      <CalendarSheet
        visible={sheet === 'calendar'}
        onClose={() => setSheet('none')}
        requestDate={result.request.date}
        plannedDays={actions.plannedDays}
        currentDate={suggestion.plannedDate}
        onConfirm={addToCalendar}
      />
      <PlannedSheet
        visible={sheet === 'planned'}
        onClose={() => setSheet('none')}
        date={suggestion.plannedDate}
        onChangeDay={() => setSheet('calendar')}
        onRemove={() => {
          setSheet('none');
          actions.removeFromCalendar(suggestion);
        }}
        onSeeWeek={() => {
          setSheet('none');
          router.push({ pathname: '/plan/week', params: { day: suggestion.plannedDate ?? '' } });
        }}
      />
      <CreditConfirmSheet visible={sheet === 'credit'} onClose={() => setSheet('none')} cost={cost} onConfirm={beginTryOn} confirming={startTryOn.isStarting} />
    </Screen>
  );
}

/** The 52 × 52 outlined round buttons beside "Takvime ekle" (✕ and the lookbook heart). The heart pops when it fills (not with reduce motion). */
function BarRoundButton({
  icon,
  active = false,
  pop = false,
  onPress,
  accessibilityLabel,
  testID,
}: {
  icon: LucideIcon;
  active?: boolean;
  pop?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
      className="h-btn-primary w-[52px] items-center justify-center rounded-pill border border-line active:opacity-70"
      testID={testID}
    >
      <HeartPop active={active} enabled={pop}>
        <Icon icon={icon} size={20} filled={active} />
      </HeartPop>
    </Pressable>
  );
}
