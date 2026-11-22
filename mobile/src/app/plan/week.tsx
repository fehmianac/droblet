import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { CalendarDays, MirrorRound, RefreshCw, Sparkles, Trash2 } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, View } from 'react-native';

import type { Occasion } from '@/api/contracts';
import { GapFillBanner, useAddSuggestedPieces } from '@/features/stylist/gapFill';
import { RequirementHint } from '@/features/requirements/RequirementHint';
import { requirementsFlow } from '@/features/requirements/store';
import { useGate } from '@/features/requirements/useRequirements';
import { useTeenRules } from '@/features/teen/store';
import { TeenStylistQuotaLine } from '@/features/teen/TeenStylist';
import { ApiError, extractApiError, isCreditsExhausted, isPaywallError } from '@/api/errors';
import type { TryOnWeekQuote } from '@/api/wire/tryon';
import { AiDropPulse, AiFailure, AiProgressLines } from '@/components/ui/ai';
import { PopoverMenu } from '@/components/ui/Bits';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { ListTabBar } from '@/components/navigation/TabBar';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { CreditConfirmSheet } from '@/features/credits/CreditConfirmSheet';
import { useLooks } from '@/features/looks/queries';
import { useAcceptPlanWeek, usePlanDays, usePlanWeekJob, usePutPlanDay, useStartPlanWeek } from '@/features/today/api';
import { combineQueries } from '@/features/today/combineQueries';
import { weekDates } from '@/features/today/dates';
import { buildWeekRows, daysToPlan, occasionCounts, weekTryOnTargets, type WeekRow } from '@/features/today/logic';
import { PlanLookSheet } from '@/features/today/PlanLookSheet';
import { WeekDayRow } from '@/features/today/WeekDayRow';
import { isQuoteChanged, useStartTryOn, useWeekTryOn } from '@/features/tryon/api';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { formatDate, formatIsoDateRange, parseLocalDate, toIsoDate } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';
import { useThemeColors } from '@/theme/useThemeColors';

/**
 * Explicit back: `ScreenHeader`'s default reads `router.canGoBack()` during render, which throws when
 * this screen is the first one rendered (deep link / cold start). Without history, go to Bugün.
 */
const goBack = () => (router.canGoBack() ? router.back() : router.replace('/today'));

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 07 Haftalık plan — the week's occasions, "Haftamı planla" (stylist-week job, accepted by the user
 * before anything is written), "Üzerimde gör" for the whole week behind the 07b credit confirmation,
 * and one row per day with a ⋯ menu (Değiştir / Kaldır) or "Planla" for an empty day; both open 07c "Bu güne look seç"
 * (a saved look, no AI), whose "Stilistten öner" is the stylist path.
 *
 * The rows are the Monday → Sunday week the board lists (Pazartesi 16 … with today in the middle, the same
 * seven days as the strip on 06), so the line above the title names that week ("BU HAFTA · 16–22 KASIM")
 * instead of the board's "ÖNÜMÜZDEKİ 7 GÜN", which would promise seven days starting today.
 */
export default function PlanWeekScreen() {
  const language = useAppLanguage();
  const { t } = useTranslation();
  const colors = useThemeColors();
  const focused = useIsFocused();
  const params = useLocalSearchParams<{ day?: string }>();
  const today = toIsoDate(new Date());
  const anchorDay = params.day && ISO_DATE.test(params.day) ? params.day : today;
  const dates = weekDates(anchorDay);
  const from = dates[0] ?? today;
  const to = dates[6] ?? today;
  const range = formatIsoDateRange(from, to);
  const eyebrow = toDisplayUpper(dates.includes(today) ? t('weekPlan.eyebrowThisWeek', { range }) : range, language);

  const plan = usePlanDays(from, to);
  const looks = useLooks();
  const query = combineQueries(plan, looks);
  const putPlanDay = usePutPlanDay();
  const tryOn = useStartTryOn();
  const weekTryOn = useWeekTryOn();
  const startPlanWeek = useStartPlanWeek();
  // Canvas 18 · 16v: an approved teen's weekly plan allowance; used up → a quiet button and "Pazartesi yenilenir".
  const teenWeekUsed = useTeenRules().stylist?.week === 'limitReached';
  const acceptPlanWeek = useAcceptPlanWeek();

  const [menu, setMenu] = useState<{ date: string; top: number } | null>(null);
  // 07c: the day whose look is being chosen (null = sheet closed).
  const [pick, setPick] = useState<WeekRow | null>(null);
  // 07b: the quote being confirmed (null = sheet closed) and why it is shown again.
  const [weekQuote, setWeekQuote] = useState<TryOnWeekQuote | null>(null);
  const [quoteChanged, setQuoteChanged] = useState(false);
  const [weekNote, setWeekNote] = useState<'bodyPhoto' | 'failed' | null>(null);
  const [tryOnJobs, setTryOnJobs] = useState<Record<string, string>>({});
  const [hint, setHint] = useState<'nothingToTryOn' | 'nothingToPlan' | null>(null);
  const [planJobId, setPlanJobId] = useState<string | null>(null);
  const planJob = usePlanWeekJob(planJobId, focused);
  const suggestedPieces = useAddSuggestedPieces();
  // "Üzerimde gör" / "Haftamı planla" with something missing: the requirements flow first (canvas 11).
  const pendingTryOn = useRef<string[]>([]);
  const pendingPlan = useRef<(() => void) | null>(null);
  const planGate = useGate('week', () => pendingPlan.current?.());

  const suggestFor = (row: WeekRow) => {
    const occasion: Occasion | null = row.plan?.occasion ?? row.look?.occasion ?? null;
    router.navigate({ pathname: '/stylist', params: occasion ? { date: row.date, occasion } : { date: row.date } });
  };

  // One day again (row "Tekrar dene"): a single try-on, 1 credit.
  const startTryOns = async (dayIds: string[]) => {
    try {
      const started = await tryOn.startMany(dayIds.map((id) => ({ kind: 'plan-day' as const, id })));
      setTryOnJobs((prev) => {
        const next = { ...prev };
        dayIds.forEach((id, i) => {
          const jobId = started[i]?.jobId;
          if (jobId) next[id] = jobId;
        });
        return next;
      });
    } catch {
      // The error is shown under the buttons from `tryOn.error`.
    }
  };

  /** Errors the screen explains itself; 402 / 403 already opened the credit sheet / paywall. */
  const weekFailed = (error: unknown) => {
    setWeekQuote(null);
    if (error instanceof ApiError && error.code === 'body_photo_required') setWeekNote('bodyPhoto');
    else if (!isPaywallError(error) && !isCreditsExhausted(error)) setWeekNote('failed');
  };

  // The whole week: one batch for the confirmed total (cached days are free).
  const confirmWeek = async (confirmed: TryOnWeekQuote) => {
    try {
      const jobs = await weekTryOn.start(confirmed);
      setTryOnJobs((prev) => ({ ...prev, ...jobs }));
      setWeekQuote(null);
      setQuoteChanged(false);
    } catch (error) {
      if (!isQuoteChanged(error)) return weekFailed(error);
      // 409 credit_quote_changed: the week changed since the quote — quote again and ask again.
      try {
        const fresh = await weekTryOn.quote(confirmed.weekStart, confirmed.dates);
        setQuoteChanged(true);
        setWeekQuote(fresh);
      } catch (again) {
        weekFailed(again);
      }
    }
  };

  const askWeek = async (fixtureDates: string[]) => {
    setWeekNote(null);
    setQuoteChanged(false);
    weekTryOn.reset();
    try {
      const quoted = await weekTryOn.quote(from, fixtureDates);
      if (quoted.dates.length === 0) setHint('nothingToTryOn');
      else if (quoted.requiredCredits === 0) await confirmWeek(quoted); // every day is cached: nothing to spend
      else setWeekQuote(quoted);
    } catch (error) {
      weekFailed(error);
    }
  };
  const tryOnGate = useGate('tryOn', () => void askWeek(pendingTryOn.current));

  return (
    <Screen>
      <ScreenHeader
        leading="back"
        onLeadingPress={goBack}
        right={<IconButton icon={CalendarDays} onPress={() => router.push('/calendar')} accessibilityLabel={t('weekPlan.calendar')} />}
      />
      <View className="gap-1.5 px-gutter pb-3.5 pt-1">
        <Text variant="eyebrow">{eyebrow}</Text>
        <Text variant="display">{t('weekPlan.title')}</Text>
      </View>
      <ScreenState
        query={query}
        isEmpty={({ a, b }) => a.length === 0 && b.length === 0}
        empty={{ message: t('weekPlan.emptyMessage'), actionLabel: t('weekPlan.emptyAction'), onAction: () => router.push('/look/new') }}
      >
        {({ a: planDays, b: lookList }) => {
          const rows = buildWeekRows(dates, planDays, lookList);
          const counts = occasionCounts(rows);
          const targets = weekTryOnTargets(rows, Object.keys(tryOnJobs));
          const toPlan = daysToPlan(rows, today);
          const proposal = planJob.isDone ? (planJob.result?.days ?? []) : [];
          const menuRow = menu ? rows.find((r) => r.date === menu.date) : undefined;
          const closeProposal = () => setPlanJobId(null);

          return (
            <>
              <ScrollView
                contentContainerClassName="gap-2 px-gutter pb-8"
                refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} tintColor={colors.muted} />}
              >
                <View className="mb-1.5 gap-2.5 rounded-card border border-line bg-paper p-3.5">
                  <Text variant="eyebrow">{t('weekPlan.occasionsEyebrow')}</Text>
                  {counts.length > 0 ? (
                    <View className="flex-row flex-wrap gap-1.5">
                      {/* Canvas chips: the week's leading occasion is the filled one. They are a summary, not a filter. */}
                      {counts.map((c, i) => (
                        <Chip
                          key={c.occasion}
                          selected={i === 0}
                          label={t('weekPlan.occasionCount', { occasion: t(`occasion.${c.occasion}`), count: c.count })}
                        />
                      ))}
                    </View>
                  ) : (
                    <Text variant="body" tone="muted">
                      {t('weekPlan.noOccasions')}
                    </Text>
                  )}

                  {planJobId && planJob.isWorking ? (
                    <View className="flex-row items-center gap-3 rounded-image-lg bg-sand p-3" accessibilityState={{ busy: true }}>
                      <AiDropPulse height={28} />
                      <View className="flex-1 gap-0.5">
                        <AiProgressLines
                          size="compact"
                          lines={[t('weekPlan.planningLines.wardrobe'), t('weekPlan.planningLines.occasions'), t('weekPlan.planningLines.days')]}
                        />
                        <Text variant="caption" tone="muted">
                          {t('weekPlan.planningNote')}
                        </Text>
                      </View>
                    </View>
                  ) : planJobId && planJob.isFailed ? (
                    <AiFailure
                      layout="inline"
                      creditRefunded={false}
                      onRetry={() => {
                        setPlanJobId(null);
                        startPlanWeek.mutate({ weekStart: from, days: toPlan }, { onSuccess: (r) => setPlanJobId(r.jobId) });
                      }}
                    />
                  ) : (
                    <View className="flex-row flex-wrap gap-2">
                      <View className="min-w-[45%] flex-1">
                        <Button
                          size="md"
                          className="px-3"
                          label={t('weekPlan.planWeek')}
                          icon={Sparkles}
                          loading={startPlanWeek.isPending}
                          disabled={teenWeekUsed}
                          testID="week-plan"
                          onPress={() => {
                            if (toPlan.length === 0) return setHint('nothingToPlan');
                            setHint(null);
                            pendingPlan.current = () => startPlanWeek.mutate({ weekStart: from, days: toPlan }, { onSuccess: (r) => setPlanJobId(r.jobId) });
                            planGate.run();
                          }}
                        />
                      </View>
                      <View className="min-w-[45%] flex-1">
                        <Button
                          variant="secondary"
                          className="px-3"
                          label={t('weekPlan.tryOn')}
                          detail={targets.length > 0 ? t('ai.creditCost', { count: targets.length }) : undefined}
                          icon={MirrorRound}
                          loading={weekTryOn.isQuoting}
                          testID="week-tryon"
                          onPress={() => {
                            if (targets.length === 0) return setHint('nothingToTryOn');
                            setHint(null);
                            tryOn.reset();
                            pendingTryOn.current = targets.map((target) => target.id);
                            tryOnGate.run();
                          }}
                        />
                      </View>
                    </View>
                  )}
                  {hint ? (
                    <Text variant="caption" tone="accent" accessibilityLiveRegion="polite">
                      {t(`weekPlan.${hint}`)}
                    </Text>
                  ) : null}
                  <TeenStylistQuotaLine kind="week" testID="week.teenQuota" />
                  <RequirementHint hint={planGate.hint} onPress={planGate.run} className="self-start" testID="week-plan-hint" />
                  <RequirementHint hint={tryOnGate.hint} onPress={tryOnGate.run} className="self-start" testID="week-tryon-hint" />
                  {weekNote === 'bodyPhoto' ? (
                    <View className="gap-1" accessibilityLiveRegion="polite">
                      <Text variant="caption" tone="danger">
                        {t('weekPlan.bodyPhotoRequired')}
                      </Text>
                      <Button variant="text" label={t('weekPlan.bodyPhotoAction')} onPress={() => requirementsFlow.open({ action: 'tryOn' })} testID="week-body-photo" />
                    </View>
                  ) : weekNote === 'failed' ? (
                    <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
                      {t(`errors.${extractApiError(weekTryOn.error)}`)}
                    </Text>
                  ) : null}
                  {tryOn.error || startPlanWeek.error ? (
                    <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
                      {t(`errors.${extractApiError(tryOn.error ?? startPlanWeek.error)}`)}
                    </Text>
                  ) : null}
                  <Text variant="caption" tone="muted">
                    {t('weekPlan.tryOnHint')}
                  </Text>
                </View>

                {rows.map((row) => (
                  <WeekDayRow
                    key={row.date}
                    row={row}
                    focused={focused}
                    tryOnJobId={tryOnJobs[row.date] ?? null}
                    onOpenMenu={(top) => setMenu({ date: row.date, top })}
                    onPlan={() => setPick(row)}
                    onRetryTryOn={() => void startTryOns([row.date])}
                  />
                ))}
              </ScrollView>

              <PopoverMenu
                visible={menu !== null}
                onClose={() => setMenu(null)}
                top={menu?.top ?? 0}
                right={32}
                actions={[
                  { key: 'change', label: t('weekPlan.change'), icon: RefreshCw, onPress: () => menuRow && setPick(menuRow) },
                  {
                    key: 'remove',
                    label: t('weekPlan.remove'),
                    icon: Trash2,
                    destructive: true,
                    // The occasion stays: only the look is taken off the day.
                    onPress: () =>
                      menuRow && putPlanDay.put(menuRow.plan, menuRow.date, { occasion: menuRow.plan?.occasion ?? null, lookId: null }),
                  },
                ]}
              />

              <PlanLookSheet
                date={pick?.date ?? null}
                occasion={pick ? (pick.plan?.occasion ?? pick.look?.occasion ?? null) : null}
                onClose={() => setPick(null)}
                onSuggest={() => pick && suggestFor(pick)}
              />

              <CreditConfirmSheet
                visible={weekQuote !== null}
                onClose={() => setWeekQuote(null)}
                cost={weekQuote?.requiredCredits ?? 0}
                scope={t('weekPlan.scopeTag')}
                confirming={weekTryOn.isStarting || weekTryOn.isQuoting}
                note={quoteChanged ? t('weekPlan.quoteChanged') : weekQuote && weekQuote.cachedCount > 0 ? t('weekPlan.cachedDays', { count: weekQuote.cachedCount }) : null}
                onConfirm={() => weekQuote && void confirmWeek(weekQuote)}
              />

              <BottomSheet visible={planJob.isDone && planJobId !== null} onClose={closeProposal}>
                <View className="gap-4">
                  <View className="gap-1.5">
                    <Text variant="eyebrow">{t('weekPlan.proposalEyebrow')}</Text>
                    <Text variant="h2">
                      {proposal.length > 0 ? t('weekPlan.proposalTitle', { count: proposal.length }) : t('weekPlan.nothingToPlan')}
                    </Text>
                    {proposal.length > 0 ? (
                      <Text variant="body" tone="muted">
                        {t('weekPlan.proposalBody')}
                      </Text>
                    ) : null}
                  </View>
                  {planJob.result?.gapFilled ? <GapFillBanner libraryItemIds={planJob.result.libraryItemIds ?? []} testID="week-gapfill" /> : null}
                  {proposal.length > 0 ? (
                    <View className="gap-2 rounded-card border border-line bg-paper p-4">
                      {proposal.map((p) => (
                        <View key={p.date}>
                          <Text variant="body" numberOfLines={2}>
                            {t('weekPlan.proposalRow', { day: formatDate(parseLocalDate(p.date), { weekday: 'long' }), look: p.lookName })}
                          </Text>
                          {p.suggested ? (
                            <Text variant="caption" tone="accent">
                              {t('req.gapFill.dayNote', { count: p.suggested })}
                            </Text>
                          ) : null}
                        </View>
                      ))}
                    </View>
                  ) : null}
                  <View className="gap-2">
                    {proposal.length > 0 ? (
                      <Button
                        label={t('weekPlan.proposalAccept')}
                        onPress={() => {
                          // The draft becomes looks + plan days on the server in one call (nothing existed before).
                          // Library picks join the wardrobe first, so the looks hold the user's own pieces.
                          const result = planJob.result;
                          if (result) {
                            void suggestedPieces
                              .add(result.libraryItemIds ?? [])
                              .catch(() => undefined)
                              .then(() => acceptPlanWeek.mutate(result));
                          }
                          closeProposal();
                        }}
                      />
                    ) : null}
                    <Button variant="secondary" label={t(proposal.length > 0 ? 'common.cancel' : 'common.ok')} onPress={closeProposal} />
                  </View>
                </View>
              </BottomSheet>
            </>
          );
        }}
      </ScreenState>
      <ListTabBar owner="index" />
    </Screen>
  );
}
