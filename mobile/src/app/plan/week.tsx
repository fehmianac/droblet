import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { CalendarDays, Pencil, Sparkles, Trash2, User } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, View } from 'react-native';

import type { Occasion } from '@/api/contracts';
import { extractApiError } from '@/api/errors';
import { AiDropPulse, AiFailure, AiProgressLines } from '@/components/ui/ai';
import { Badge, PopoverMenu } from '@/components/ui/Bits';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { CreditConfirmSheet } from '@/features/credits/CreditConfirmSheet';
import { useLooks } from '@/features/looks/queries';
import { usePlanDays, usePlanWeekJob, usePutPlanDay, useStartPlanWeek } from '@/features/today/api';
import { combineQueries } from '@/features/today/combineQueries';
import { weekDates } from '@/features/today/dates';
import { buildWeekRows, daysToPlan, occasionCounts, weekTryOnTargets, type WeekRow } from '@/features/today/logic';
import { WeekDayRow } from '@/features/today/WeekDayRow';
import { useStartTryOn } from '@/features/tryon/api';
import { formatDate, parseLocalDate, toIsoDate } from '@/lib/format';
import { useThemeColors } from '@/theme/useThemeColors';

function WeekSkeleton() {
  return (
    <View className="gap-3 px-gutter pt-2">
      <Skeleton className="h-36 w-full rounded-card" />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-[94px] w-full rounded-card" />
      ))}
    </View>
  );
}

/**
 * Explicit back: `ScreenHeader`'s default reads `router.canGoBack()` during render, which throws when
 * this screen is the first one rendered (deep link / cold start). Without history, go to Bugün.
 */
const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 07 Haftalık plan — the week's occasions, "Haftamı planla" (stylist-week job, accepted by the user
 * before anything is written), "Üzerimde gör" for the whole week behind the 07b credit confirmation,
 * and one row per day with a ⋯ menu (Değiştir / Kaldır) or "Öner" for an empty day.
 */
export default function PlanWeekScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const focused = useIsFocused();
  const params = useLocalSearchParams<{ day?: string }>();
  const today = toIsoDate(new Date());
  const anchorDay = params.day && ISO_DATE.test(params.day) ? params.day : today;
  const dates = weekDates(anchorDay);
  const from = dates[0] ?? today;
  const to = dates[6] ?? today;

  const plan = usePlanDays(from, to);
  const looks = useLooks();
  const query = combineQueries(plan, looks);
  const putPlanDay = usePutPlanDay();
  const tryOn = useStartTryOn();
  const startPlanWeek = useStartPlanWeek();

  const [menu, setMenu] = useState<{ date: string; top: number } | null>(null);
  const [creditSheet, setCreditSheet] = useState(false);
  const [tryOnJobs, setTryOnJobs] = useState<Record<string, string>>({});
  const [hint, setHint] = useState<'nothingToTryOn' | 'nothingToPlan' | null>(null);
  const [planJobId, setPlanJobId] = useState<string | null>(null);
  const planJob = usePlanWeekJob(planJobId, focused);

  const suggestFor = (row: WeekRow) => {
    const occasion: Occasion | null = row.plan?.occasion ?? row.look?.occasion ?? null;
    router.navigate({ pathname: '/stylist', params: occasion ? { date: row.date, occasion } : { date: row.date } });
  };

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
    } finally {
      setCreditSheet(false);
    }
  };

  return (
    <Screen bottom>
      <ScreenHeader
        leading="back"
        onLeadingPress={goBack}
        right={<IconButton icon={CalendarDays} onPress={() => router.push('/calendar')} accessibilityLabel={t('weekPlan.calendar')} />}
      />
      <View className="gap-1 px-gutter pb-3">
        <Text variant="eyebrow">{t('weekPlan.eyebrow')}</Text>
        <Text variant="display">{t('weekPlan.title')}</Text>
      </View>
      <ScreenState
        query={query}
        skeleton={<WeekSkeleton />}
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
                contentContainerClassName="gap-3 px-gutter pb-8 pt-1"
                refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} tintColor={colors.muted} />}
              >
                <View className="gap-3 rounded-card border border-line bg-paper p-4">
                  <Text variant="eyebrow">{t('weekPlan.occasionsEyebrow')}</Text>
                  {counts.length > 0 ? (
                    <View className="flex-row flex-wrap gap-2">
                      {counts.map((c) => (
                        <Badge key={c.occasion} label={t('weekPlan.occasionCount', { occasion: t(`occasion.${c.occasion}`), count: c.count })} />
                      ))}
                    </View>
                  ) : (
                    <Text variant="body" tone="muted">
                      {t('weekPlan.noOccasions')}
                    </Text>
                  )}

                  {planJobId && planJob.isWorking ? (
                    <View className="flex-row items-center gap-3 rounded-image-lg bg-sand p-3" accessibilityState={{ busy: true }}>
                      <AiDropPulse height={28} hookTone="sand" />
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
                          label={t('weekPlan.planWeek')}
                          icon={Sparkles}
                          loading={startPlanWeek.isPending}
                          onPress={() => {
                            if (toPlan.length === 0) return setHint('nothingToPlan');
                            setHint(null);
                            startPlanWeek.mutate({ weekStart: from, days: toPlan }, { onSuccess: (r) => setPlanJobId(r.jobId) });
                          }}
                        />
                      </View>
                      <View className="min-w-[45%] flex-1">
                        <Button
                          variant="secondary"
                          className="h-btn-primary"
                          label={t('weekPlan.tryOn')}
                          icon={User}
                          onPress={() => {
                            if (targets.length === 0) return setHint('nothingToTryOn');
                            setHint(null);
                            tryOn.reset();
                            setCreditSheet(true);
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
                    isToday={row.date === today}
                    focused={focused}
                    tryOnJobId={tryOnJobs[row.date] ?? null}
                    onOpenMenu={(top) => setMenu({ date: row.date, top })}
                    onSuggest={() => suggestFor(row)}
                    onRetryTryOn={() => void startTryOns([row.date])}
                  />
                ))}
              </ScrollView>

              <PopoverMenu
                visible={menu !== null}
                onClose={() => setMenu(null)}
                top={menu?.top ?? 0}
                actions={[
                  { key: 'change', label: t('weekPlan.change'), icon: Pencil, onPress: () => menuRow && suggestFor(menuRow) },
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

              <CreditConfirmSheet
                visible={creditSheet}
                onClose={() => setCreditSheet(false)}
                cost={targets.length}
                scope={t('weekPlan.scopeTag')}
                confirming={tryOn.isStarting}
                onConfirm={() => void startTryOns(targets.map((target) => target.id))}
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
                  {proposal.length > 0 ? (
                    <View className="gap-2 rounded-card border border-line bg-paper p-4">
                      {proposal.map((p) => (
                        <Text key={p.date} variant="body" numberOfLines={2}>
                          {t('weekPlan.proposalRow', { day: formatDate(parseLocalDate(p.date), { weekday: 'long' }), look: p.lookName })}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                  <View className="gap-2">
                    {proposal.length > 0 ? (
                      <Button
                        label={t('weekPlan.proposalAccept')}
                        onPress={() => {
                          proposal.forEach((p) =>
                            putPlanDay.put(planDays.find((d) => d.date === p.date) ?? null, p.date, { occasion: p.occasion, lookId: p.lookId }),
                          );
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
    </Screen>
  );
}
