import { router } from 'expo-router';
import { ChevronLeft, ChevronRight, Shirt, Sparkles, X } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import type { Look } from '@/api/contracts/looks';
import { Badge } from '@/components/ui/Bits';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { ListTabBar } from '@/components/navigation/TabBar';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useLooks } from '@/features/looks/queries';
import { useCalendarMonth } from '@/features/today/api';
import { combineQueries } from '@/features/today/combineQueries';
import { monthGrid, monthOf, shiftMonth, weekDates } from '@/features/today/dates';
import { dayStatus, type DayStatus } from '@/features/today/logic';
import { currentLanguage } from '@/i18n';
import { formatDate, formatMonthYear, formatNumber, parseLocalDate, toIsoDate, weekdayShort } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';
import { useThemeColors } from '@/theme/useThemeColors';

/**
 * Explicit back: `ScreenHeader`'s default reads `router.canGoBack()` during render, which throws when
 * this screen is the first one rendered (deep link / cold start). Without history, go to Bugün.
 */
const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

/** One class set per state — never two competing border utilities on the same cell. */
function cellClass(kind: DayStatus['kind'], isToday: boolean): string {
  if (isToday) return `border-2 border-ink ${kind === 'worn' ? 'bg-accent' : kind === 'planned' ? 'bg-sand' : ''}`;
  if (kind === 'worn') return 'bg-accent';
  if (kind === 'planned') return 'border border-accent bg-sand';
  return 'border border-dashed border-line';
}

function CalendarSkeleton() {
  return (
    <View className="gap-2 px-gutter pt-2">
      {[0, 1, 2, 3, 4].map((row) => (
        <View key={row} className="flex-row gap-1.5">
          {[0, 1, 2, 3, 4, 5, 6].map((cell) => (
            <View key={cell} className="flex-1">
              <Skeleton className="aspect-[4/5] w-full rounded-[10px]" />
            </View>
          ))}
        </View>
      ))}
      <Skeleton className="mt-3 h-20 w-full rounded-card" />
    </View>
  );
}

/**
 * 09 Takvim — "ne giyeceğim, ne giydim": a Monday-first month grid (worn and planned days are
 * filled), a day sheet with that day's look or a stylist suggestion, and the month's summary.
 */
export default function CalendarScreen() {
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
      <View className="gap-1 px-gutter pb-3">
        <Text variant="eyebrow">{t('calendarScreen.eyebrow')}</Text>
        <View className="flex-row items-center justify-between gap-3">
          <Text variant="display" className="flex-1" numberOfLines={1} adjustsFontSizeToFit>
            {formatMonthYear(monthDate)}
          </Text>
          <View className="flex-row gap-2">
            <IconButton icon={ChevronLeft} onPress={() => setMonth(shiftMonth(month, -1))} accessibilityLabel={t('calendarScreen.prevMonth')} />
            <IconButton icon={ChevronRight} onPress={() => setMonth(shiftMonth(month, 1))} accessibilityLabel={t('calendarScreen.nextMonth')} />
          </View>
        </View>
      </View>
      <View className="flex-row gap-1.5 px-gutter pb-2" accessible={false} importantForAccessibility="no-hide-descendants">
        {weekdays.map((w, i) => (
          <Text key={`${w}${i}`} variant="caption" tone="muted" className="flex-1 text-center" numberOfLines={1}>
            {w}
          </Text>
        ))}
      </View>
      <ScreenState query={query} skeleton={<CalendarSkeleton />}>
        {({ a: data, b: lookList }) => {
          const lookOf = (status: DayStatus): Look | null =>
            status.kind !== 'empty' && status.lookId ? (lookList.find((l) => l.id === status.lookId) ?? null) : null;
          const selectedStatus = selected ? dayStatus(selected, data) : null;
          const selectedLook = selectedStatus ? lookOf(selectedStatus) : null;
          const pieces = selectedLook ? t('product.piecesCount', { count: selectedLook.slots.length }) : null;
          return (
            <>
              <ScrollView
                contentContainerClassName="gap-5 px-gutter pb-8"
                refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} tintColor={colors.muted} />}
              >
                <View className="gap-1.5">
                  {monthGrid(month).map((row, r) => (
                    <View key={r} className="flex-row gap-1.5">
                      {row.map((date, c) => {
                        if (!date) return <View key={c} className="flex-1" />;
                        const status = dayStatus(date, data);
                        const filled = status.kind !== 'empty';
                        const isToday = date === today;
                        const dateLabel = formatDate(parseLocalDate(date), { day: 'numeric', month: 'long' });
                        const base = t(
                          status.kind === 'worn' ? 'calendarScreen.dayWorn' : status.kind === 'planned' ? 'calendarScreen.dayPlanned' : 'calendarScreen.dayEmpty',
                          { date: dateLabel },
                        );
                        return (
                          <Pressable
                            key={c}
                            onPress={() => setSelected(date)}
                            accessibilityRole="button"
                            accessibilityLabel={isToday ? t('calendarScreen.dayToday', { label: base }) : base}
                            className={`aspect-[4/5] flex-1 items-center justify-between rounded-[10px] py-1.5 active:opacity-70 ${cellClass(status.kind, isToday)}`}
                          >
                            <Text
                              variant={isToday ? 'bodyMedium' : 'caption'}
                              tone={status.kind === 'worn' ? 'paper' : isToday ? 'ink' : 'muted'}
                              maxFontSizeMultiplier={1.2}
                            >
                              {formatNumber(Number(date.slice(8)))}
                            </Text>
                            {filled ? <Icon icon={Shirt} size={14} tone={status.kind === 'worn' ? 'paper' : 'accent'} /> : <View className="h-3.5" />}
                          </Pressable>
                        );
                      })}
                    </View>
                  ))}
                </View>

                <View className="flex-row items-center gap-3 rounded-card border border-line bg-paper p-4">
                  <View className="flex-1 gap-1">
                    <Text variant="eyebrow">{t('calendarScreen.summaryEyebrow')}</Text>
                    <Text variant="h3">
                      {data.summary.daysLogged > 0 ? t('calendarScreen.daysLogged', { count: data.summary.daysLogged }) : t('calendarScreen.noLogs')}
                    </Text>
                    {data.summary.mostWorn ? (
                      <Text variant="caption" tone="muted">
                        {t('calendarScreen.mostWorn', { name: data.summary.mostWorn.name })}
                      </Text>
                    ) : null}
                  </View>
                  <Chip label={t('calendarScreen.report')} disabled badge={t('common.comingSoon')} />
                </View>
              </ScrollView>

              <BottomSheet visible={selected !== null} onClose={() => setSelected(null)}>
                {selected && selectedStatus ? (
                  <View className="gap-4">
                    <View className="flex-row items-center justify-between gap-3">
                      <Text variant="eyebrow" className="flex-1">
                        {toDisplayUpper(formatDate(parseLocalDate(selected), { day: 'numeric', month: 'long' }), currentLanguage())}
                      </Text>
                      <IconButton icon={X} variant="plain" onPress={() => setSelected(null)} accessibilityLabel={t('a11y.close')} />
                    </View>
                    {selectedStatus.kind !== 'empty' ? (
                      <>
                        <View className="flex-row items-center gap-3">
                          <PlaceholderImage uri={selectedLook?.tryOnImageUrl} className="h-[88px] w-[70px] rounded-image" />
                          <View className="flex-1 gap-1.5">
                            <Badge
                              label={t(selectedStatus.kind === 'worn' ? 'calendarScreen.statusWorn' : 'calendarScreen.statusPlanned')}
                              tone={selectedStatus.kind === 'worn' ? 'accent' : 'sand'}
                            />
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
                                className="h-btn-primary"
                                label={t('calendarScreen.openLook')}
                                onPress={() => {
                                  setSelected(null);
                                  router.push({ pathname: '/look/new', params: { id: selectedLook.id } });
                                }}
                              />
                            </View>
                          ) : null}
                          <View className="min-w-[45%] flex-1">
                            <Button label={t('calendarScreen.change')} onPress={() => suggest(selected)} />
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
