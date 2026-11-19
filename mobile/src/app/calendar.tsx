import { router } from 'expo-router';
import { ChevronLeft, ChevronRight, Sparkles, X } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import type { Look } from '@/api/contracts/looks';
import { Badge } from '@/components/ui/Bits';
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
import { coverPieces } from '@/features/looks/LookCover';
import { useLooks } from '@/features/looks/queries';
import { useCalendarMonth } from '@/features/today/api';
import { combineQueries } from '@/features/today/combineQueries';
import { monthGrid, monthOf, shiftMonth, weekDates } from '@/features/today/dates';
import { dayStatus, type DayStatus } from '@/features/today/logic';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { formatDate, formatMonthYear, formatNumber, parseLocalDate, toIsoDate, weekdayShort } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';
import { useThemeColors } from '@/theme/useThemeColors';

/**
 * Explicit back: `ScreenHeader`'s default reads `router.canGoBack()` during render, which throws when
 * this screen is the first one rendered (deep link / cold start). Without history, go to Bugün.
 */
const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

/**
 * 09 Takvim — "ne giyeceğim, ne giydim": a Monday-first month grid (the day number above a 52-high box:
 * the look's thumbnail on worn and planned days, a dashed box on empty ones), a day sheet with that day's
 * look or a stylist suggestion, and the month's summary with "Rapor" → the month report.
 */
export default function CalendarScreen() {
  const language = useAppLanguage();
  const { t } = useTranslation();
  const colors = useThemeColors();
  const today = toIsoDate(new Date());
  const [month, setMonth] = useState(monthOf(today));
  const [selected, setSelected] = useState<string | null>(null);

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

  return (
    <Screen>
      <ScreenHeader leading="back" onLeadingPress={goBack} />
      <View className="gap-1.5 px-gutter pb-3.5 pt-1">
        <Text variant="eyebrow">{t('calendarScreen.eyebrow')}</Text>
        <View className="flex-row items-center justify-between gap-3">
          <Text variant="display" className="flex-1" numberOfLines={1} adjustsFontSizeToFit>
            {formatMonthYear(monthDate)}
          </Text>
          <View className="flex-row gap-1.5">
            <IconButton icon={ChevronLeft} iconSize={18} onPress={() => setMonth(shiftMonth(month, -1))} accessibilityLabel={t('calendarScreen.prevMonth')} />
            <IconButton icon={ChevronRight} iconSize={18} onPress={() => setMonth(shiftMonth(month, 1))} accessibilityLabel={t('calendarScreen.nextMonth')} />
          </View>
        </View>
      </View>
      <View className="flex-row gap-[5px] px-gutter pb-3.5" accessible={false} importantForAccessibility="no-hide-descendants">
        {weekdays.map((w, i) => (
          <Text key={`${w}${i}`} variant="tab" tone="muted" className="flex-1 text-center" numberOfLines={1}>
            {w}
          </Text>
        ))}
      </View>
      <ScreenState query={query}>
        {({ a: data, b: lookList }) => {
          const lookOf = (status: DayStatus): Look | null =>
            status.kind !== 'empty' && status.lookId ? (lookList.find((l) => l.id === status.lookId) ?? null) : null;
          const selectedStatus = selected ? dayStatus(selected, data) : null;
          const selectedLook = selectedStatus ? lookOf(selectedStatus) : null;
          const pieces = selectedLook ? t('product.piecesCount', { count: selectedLook.slots.length }) : null;
          return (
            <>
              <ScrollView
                contentContainerClassName="gap-3.5 px-gutter pb-8"
                refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} tintColor={colors.muted} />}
              >
                <View className="gap-[5px]">
                  {monthGrid(month).map((row, r) => (
                    <View key={r} className="flex-row gap-[5px]">
                      {row.map((date, c) => {
                        if (!date) return <View key={c} className="flex-1" />;
                        const status = dayStatus(date, data);
                        const isToday = date === today;
                        const dateLabel = formatDate(parseLocalDate(date), { day: 'numeric', month: 'long' });
                        const base = t(
                          status.kind === 'worn' ? 'calendarScreen.dayWorn' : status.kind === 'planned' ? 'calendarScreen.dayPlanned' : 'calendarScreen.dayEmpty',
                          { date: dateLabel },
                        );
                        const image = lookOf(status)?.tryOnImageUrl ?? null;
                        return (
                          <Pressable
                            key={c}
                            onPress={() => setSelected(date)}
                            accessibilityRole="button"
                            accessibilityLabel={isToday ? t('calendarScreen.dayToday', { label: base }) : base}
                            className="flex-1 items-center gap-[3px] active:opacity-70"
                          >
                            <Text
                              variant="badge"
                              tone={isToday ? 'ink' : 'muted'}
                              className={isToday ? 'font-sans-semibold' : 'font-sans'}
                              maxFontSizeMultiplier={1.2}
                            >
                              {formatNumber(Number(date.slice(8)))}
                            </Text>
                            {status.kind === 'empty' ? (
                              <View className="h-[52px] w-full rounded-lg border border-dashed border-line" />
                            ) : (
                              <View className="h-[52px] w-full items-center justify-center overflow-hidden rounded-lg">
                                <ImageSlot
                                  uri={image}
                                  className="h-full w-full"
                                  placeholder={{ kind: 'figure', seed: lookOf(status)?.id, figureHeight: 33 }}
                                />
                              </View>
                            )}
                          </Pressable>
                        );
                      })}
                    </View>
                  ))}
                </View>

                <View className="flex-row items-center gap-3.5 rounded-card border border-line bg-paper p-3.5">
                  <View className="flex-1 gap-1">
                    <Text variant="eyebrow">{t('calendarScreen.summaryEyebrow')}</Text>
                    <Text variant="title">
                      {data.summary.daysLogged > 0 ? t('calendarScreen.daysLogged', { count: data.summary.daysLogged }) : t('calendarScreen.noLogs')}
                    </Text>
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
                      <>
                        <View className="flex-row items-center gap-3.5">
                          <View className="h-[124px] w-24 items-center justify-center overflow-hidden rounded-image">
                            <ImageSlot
                              uri={selectedLook?.tryOnImageUrl}
                              className="h-full w-full"
                              placeholder={{
                                kind: 'look',
                                pieces: selectedLook ? coverPieces(selectedLook.slots, undefined, 73) : [],
                                seed: selectedLook?.id,
                                figureHeight: 73,
                              }}
                            />
                          </View>
                          <View className="flex-1 gap-1.5">
                            <Badge label={t(selectedStatus.kind === 'worn' ? 'calendarScreen.statusWorn' : 'calendarScreen.statusPlanned')} />
                            <Text variant="h3" numberOfLines={2}>
                              {selectedLook?.name ?? t('calendarScreen.savedLook')}
                            </Text>
                            {selectedLook && pieces ? (
                              <Text variant="caption" tone="muted">
                                {t('calendarScreen.lookMeta', { occasion: t(`occasion.${selectedLook.occasion}`), pieces })}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                        <View className="flex-row flex-wrap gap-2">
                          {selectedLook ? (
                            <View className="min-w-[45%] flex-1">
                              <Button
                                variant="secondary"
                                label={t('calendarScreen.openLook')}
                                onPress={() => {
                                  setSelected(null);
                                  router.push({ pathname: '/look/[id]', params: { id: selectedLook.id } });
                                }}
                              />
                            </View>
                          ) : null}
                          <View className="min-w-[45%] flex-1">
                            <Button size="md" label={t('calendarScreen.change')} onPress={() => suggest(selected)} />
                          </View>
                        </View>
                      </>
                    ) : (
                      <>
                        <Text variant="body" tone="muted">
                          {t('calendarScreen.emptyDay')}
                        </Text>
                        <Button label={t('calendarScreen.suggestForDay')} icon={Sparkles} onPress={() => suggest(selected)} />
                      </>
                    )}
                  </View>
                ) : null}
              </BottomSheet>
            </>
          );
        }}
      </ScreenState>
      <ListTabBar owner="index" />
    </Screen>
  );
}
