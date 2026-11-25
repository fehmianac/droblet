import { router } from 'expo-router';
import { Check, ChevronLeft, ChevronRight, Sparkles, X } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import type { Look } from '@/api/contracts/looks';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { ListTabBar } from '@/components/navigation/TabBar';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { lookCoverSource } from '@/api/imageSources';
import { Chip } from '@/components/ui/Chip';
import { indexItems, LookCover } from '@/features/looks/LookCover';
import { useItems } from '@/features/wardrobe/queries';
import { useWearToday } from '@/api/today';
import { DayLook } from '@/features/today/DayLook';
import { PlanSwitch } from '@/features/today/PlanSwitch';
import { useLooks } from '@/features/looks/queries';
import { useCalendarMonth, usePutPlanDay } from '@/features/today/api';
import { combineQueries } from '@/features/today/combineQueries';
import { monthGrid, monthOf, shiftMonth, weekDates } from '@/features/today/dates';
import { dayStatus, monthDayCounts, type DayStatus, type MonthFilter } from '@/features/today/logic';
import { PlanLookSheet } from '@/features/today/PlanLookSheet';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { formatDate, formatMonthYear, formatNumber, parseLocalDate, toIsoDate, weekdayShort } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';
import { useThemeColors } from '@/theme/useThemeColors';

/**
 * Explicit back: `ScreenHeader`'s default reads `router.canGoBack()` during render, which throws when
 * this screen is the first one rendered (deep link / cold start). Without history, go to Bugün.
 */
const goBack = () => (router.canGoBack() ? router.back() : router.replace('/today'));

/**
 * 09 Takvim — "ne giyeceğim, ne giydim": a Monday-first month grid (the day number above a 52-high box:
 * the look's thumbnail on worn and planned days, a dashed box on empty ones), a day sheet with that day's
 * look ("Değiştir") or, on an empty day, "Planla" + "Stilistten öner" — both ways to choose open 07c "Bu güne look
 * seç" (a saved look, no AI) — and the month's summary with "Rapor" → the month report.
 */
export default function CalendarScreen() {
  const language = useAppLanguage();
  const { t } = useTranslation();
  const colors = useThemeColors();
  const today = toIsoDate(new Date());
  const [month, setMonth] = useState(monthOf(today));
  const [selected, setSelected] = useState<string | null>(null);
  // 07c: the day whose look is being chosen (null = sheet closed).
  const [pick, setPick] = useState<string | null>(null);

  // 09′: the whole month, or only what was worn / what is planned.
  const [filter, setFilter] = useState<MonthFilter>('all');
  const items = useItems();
  const itemsById = indexItems(items.data);
  const putPlan = usePutPlanDay();
  const wear = useWearToday();

  const calendar = useCalendarMonth(month);
  const looks = useLooks();
  const query = combineQueries(calendar, looks);
  const monthDate = parseLocalDate(`${month}-01`);
  // Weekday names come from Intl, in Monday-first order.
  const weekdays = weekDates(today).map((d) => weekdayShort(parseLocalDate(d)));

  const suggest = (date: string) => {
    setSelected(null);
    router.navigate({ pathname: '/stylist', params: { date } });
  };
  const planDay = (date: string) => {
    setSelected(null);
    setPick(date);
  };

  return (
    <Screen>
      <ScreenHeader leading="back" onLeadingPress={goBack} />
      <View className="gap-1.5 px-gutter pb-3.5 pt-1">
        <Text variant="eyebrow">{t('calendarScreen.eyebrow')}</Text>
        <Text variant="display">{t('calendarScreen.title')}</Text>
        <View className="pb-1 pt-2">
          <PlanSwitch value="month" />
        </View>
        <View className="flex-row items-center justify-between gap-3">
          <Text variant="h2" className="flex-1" numberOfLines={1} adjustsFontSizeToFit>
            {formatMonthYear(monthDate)}
          </Text>
          <View className="flex-row gap-1.5">
            <IconButton icon={ChevronLeft} iconSize={18} onPress={() => setMonth(shiftMonth(month, -1))} accessibilityLabel={t('calendarScreen.prevMonth')} />
            <IconButton icon={ChevronRight} iconSize={18} onPress={() => setMonth(shiftMonth(month, 1))} accessibilityLabel={t('calendarScreen.nextMonth')} />
          </View>
        </View>
      </View>
      <ScreenState query={query}>
        {({ a: data, b: lookList }) => {
          const lookOf = (status: DayStatus): Look | null =>
            status.kind !== 'empty' && status.lookId ? (lookList.find((l) => l.id === status.lookId) ?? null) : null;
          const selectedStatus = selected ? dayStatus(selected, data) : null;
          const selectedLook = selectedStatus ? lookOf(selectedStatus) : null;
          const pieces = selectedLook ? t('product.piecesCount', { count: selectedLook.slots.length }) : null;
          const counts = monthDayCounts(data, today, (id) => Boolean(lookList.find((l) => l.id === id)?.tryOnImageUrl));
          const logsOn = (date: string) => data.wearLogs.filter((w) => w.date === date).length;
          const shows = (status: DayStatus) => filter === 'all' || (filter === 'worn' ? status.kind === 'worn' : status.kind === 'planned');
          const selectedPlan = selected ? (data.planDays.find((p) => p.date === selected) ?? null) : null;
          const missed = selectedStatus?.kind === 'planned' && selected !== null && selected < today;
          return (
            <>
              <ScrollView
                contentContainerClassName="gap-3.5 px-gutter pb-8"
                refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} tintColor={colors.muted} />}
              >
                <View className="flex-row flex-wrap gap-1.5" accessibilityRole="tablist">
                  {(['all', 'worn', 'planned'] as const).map((f) => (
                    <Chip
                      key={f}
                      label={f === 'all' ? t('calendarScreen.filterAll') : t(`calendarScreen.filter.${f}`, { count: f === 'worn' ? counts.worn : counts.planned })}
                      selected={filter === f}
                      onPress={() => setFilter(f)}
                      testID={`calendar-filter-${f}`}
                    />
                  ))}
                </View>
                <View className="flex-row gap-1" accessible={false} importantForAccessibility="no-hide-descendants">
                  {weekdays.map((w, i) => (
                    <Text key={`${w}${i}`} variant="tab" tone="muted" className="flex-1 text-center" numberOfLines={1}>
                      {w}
                    </Text>
                  ))}
                </View>
                <View className="gap-1">
                  {monthGrid(month).map((row, r) => (
                    <View key={r} className="flex-row gap-1">
                      {row.map((date, c) => {
                        if (!date) return <View key={c} className="flex-1" />;
                        const status = dayStatus(date, data);
                        const isToday = date === today;
                        const dateLabel = formatDate(parseLocalDate(date), { day: 'numeric', month: 'long' });
                        const base = t(
                          status.kind === 'worn' ? 'calendarScreen.dayWorn' : status.kind === 'planned' ? 'calendarScreen.dayPlanned' : 'calendarScreen.dayEmpty',
                          { date: dateLabel },
                        );
                        const look = lookOf(status);
                        // 09′: the day's card. The "on you" image when one exists (never made here), else the look's cover.
                        const filled = status.kind !== 'empty' && shows(status);
                        const more = logsOn(date) - 1;
                        return (
                          <Pressable
                            key={c}
                            onPress={() => setSelected(date)}
                            accessibilityRole="button"
                            accessibilityLabel={isToday ? t('calendarScreen.dayToday', { label: base }) : base}
                            testID={`calendar-day-${date}`}
                            className={`h-[78px] flex-1 gap-[3px] rounded-[10px] p-1 active:opacity-70 ${
                              isToday ? 'border-[1.5px] border-ink' : filled ? 'border border-line' : 'border border-dashed border-line'
                            } ${filled ? 'bg-paper' : ''}`}
                          >
                            <Text
                              variant="badge"
                              tone={isToday ? 'ink' : 'muted'}
                              className={isToday ? 'font-sans-semibold' : 'font-sans'}
                              maxFontSizeMultiplier={1.2}
                            >
                              {formatNumber(Number(date.slice(8)))}
                            </Text>
                            {filled ? (
                              <View className="w-full flex-1 overflow-hidden rounded-[7px]">
                                {look ? (
                                  <LookCover
                                    seed={look.id}
                                    figureHeight={34}
                                    cover={look.tryOnImageUrl ? null : lookCoverSource(look)}
                                    tryOnImageUrl={look.tryOnImageUrl}
                                    slots={look.slots}
                                    itemsById={itemsById}
                                    className="h-full w-full"
                                  />
                                ) : (
                                  <ImageSlot uri={null} className="h-full w-full" placeholder={{ kind: 'figure', figureHeight: 33 }} />
                                )}
                              </View>
                            ) : null}
                            {filled && status.kind === 'worn' ? (
                              <View className="absolute right-[3px] top-[3px] h-[13px] w-[13px] items-center justify-center rounded-pill bg-feed-owned" testID={`calendar-worn-${date}`}>
                                <Icon icon={Check} size={9} tone="paper" />
                              </View>
                            ) : null}
                            {filled && more > 0 ? (
                              <View className="absolute bottom-1.5 right-1.5 rounded-[5px] bg-cream px-[3px]">
                                <Text variant="badge" className="text-[9px]" maxFontSizeMultiplier={1.2}>
                                  {t('calendarScreen.more', { count: more })}
                                </Text>
                              </View>
                            ) : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  ))}
                </View>

                <View className="flex-row flex-wrap gap-x-3.5 gap-y-1" accessible={false} importantForAccessibility="no-hide-descendants">
                  <View className="flex-row items-center gap-[5px]">
                    <View className="h-[13px] w-[13px] items-center justify-center rounded-pill bg-feed-owned">
                      <Icon icon={Check} size={9} tone="paper" />
                    </View>
                    <Text variant="caption" tone="muted">
                      {t('calendarScreen.statusWorn')}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-[5px]">
                    <View className="h-[13px] w-[13px] rounded-[4px] border-[1.5px] border-ink" />
                    <Text variant="caption" tone="muted">
                      {t('calendarScreen.legendToday')}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-[5px]">
                    <View className="h-[13px] w-[13px] rounded-[4px] border border-dashed border-muted" />
                    <Text variant="caption" tone="muted">
                      {t('calendarScreen.legendEmpty')}
                    </Text>
                  </View>
                </View>

                <View className="flex-row items-center gap-3.5 rounded-card border border-line bg-paper p-3.5">
                  <View className="flex-1 gap-1">
                    <Text variant="eyebrow">{t('calendarScreen.summaryEyebrow')}</Text>
                    <Text variant="title">
                      {data.summary.daysLogged > 0 ? t('calendarScreen.daysLogged', { count: data.summary.daysLogged }) : t('calendarScreen.noLogs')}
                    </Text>
                    {counts.planned > 0 || counts.tried > 0 ? (
                      <Text variant="caption" tone="muted" testID="calendar-summary-line">
                        {[
                          counts.planned > 0 ? t('calendarScreen.plannedDays', { count: counts.planned }) : null,
                          counts.tried > 0 ? t('calendarScreen.triedLooks', { count: counts.tried }) : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    ) : null}
                    {data.summary.mostWorn ? (
                      <Text variant="caption" tone="muted">
                        {t('calendarScreen.mostWorn', { name: data.summary.mostWorn.name })}
                      </Text>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={() => router.push({ pathname: '/plan/report', params: { month } })}
                    accessibilityRole="button"
                    accessibilityLabel={t('calendarScreen.reportA11y', { month: formatMonthYear(monthDate) })}
                    hitSlop={4}
                    className="h-chip flex-row items-center gap-1.5 rounded-pill border border-line px-[15px] active:opacity-80"
                  >
                    <Text variant="chip" numberOfLines={1}>
                      {t('calendarScreen.report')}
                    </Text>
                    <Icon icon={ChevronRight} size={14} />
                  </Pressable>
                </View>
              </ScrollView>

              <BottomSheet visible={selected !== null} onClose={() => setSelected(null)}>
                {selected && selectedStatus ? (
                  <View className="gap-3.5">
                    <View className="flex-row items-center justify-between gap-3">
                      <Text variant="eyebrow" className="flex-1">
                        {toDisplayUpper(formatDate(parseLocalDate(selected), { day: 'numeric', month: 'long' }), language)}
                      </Text>
                      <IconButton icon={X} variant="plain" onPress={() => setSelected(null)} accessibilityLabel={t('a11y.close')} />
                    </View>
                    {selectedStatus.kind !== 'empty' ? (
                      <DayLook
                        look={selectedLook}
                        status={selectedStatus.kind === 'worn' ? 'worn' : missed ? 'missed' : 'planned'}
                        meta={selectedLook && pieces ? t('calendarScreen.lookMeta', { occasion: t(`occasion.${selectedLook.occasion}`), pieces }) : null}
                        itemsById={itemsById}
                        onOpen={() => {
                          setSelected(null);
                          if (selectedLook) router.push({ pathname: '/look/[id]', params: { id: selectedLook.id } });
                        }}
                        onChange={() => planDay(selected)}
                        onRemove={
                          selectedStatus.kind === 'planned' && selectedPlan
                            ? () => {
                                putPlan.put(selectedPlan, selected, { occasion: selectedPlan.occasion, lookId: null });
                                setSelected(null);
                              }
                            : null
                        }
                        onWore={
                          missed && selectedLook
                            ? () => {
                                wear.wear(selectedLook.id, selected);
                                setSelected(null);
                              }
                            : null
                        }
                      />
                    ) : (
                      <>
                        <Text variant="body" tone="muted">
                          {t('calendarScreen.emptyDay')}
                        </Text>
                        <View className="flex-row flex-wrap gap-2">
                          <View className="min-w-[45%] flex-1">
                            <Button size="md" label={t('calendarScreen.plan')} onPress={() => planDay(selected)} testID="calendar-plan" />
                          </View>
                          <View className="min-w-[45%] flex-1">
                            <Button
                              variant="secondary"
                              className="px-3"
                              icon={Sparkles}
                              label={t('calendarScreen.suggestForDay')}
                              onPress={() => suggest(selected)}
                              testID="calendar-suggest"
                            />
                          </View>
                        </View>
                      </>
                    )}
                  </View>
                ) : null}
              </BottomSheet>
              <PlanLookSheet date={pick} onClose={() => setPick(null)} onSuggest={() => pick && suggest(pick)} />
            </>
          );
        }}
      </ScreenState>
      <ListTabBar owner="index" />
    </Screen>
  );
}
