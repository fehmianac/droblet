import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import type { Item } from '@/api/contracts/wardrobe';
import { Badge } from '@/components/ui/Bits';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { useLooks } from '@/features/looks/queries';
import { useCalendarMonth } from '@/features/today/api';
import { combineQueries } from '@/features/today/combineQueries';
import { monthOf } from '@/features/today/dates';
import { buildMonthReport } from '@/features/today/logic';
import { ItemThumb } from '@/features/wardrobe/ItemThumb';
import { useItems } from '@/features/wardrobe/queries';
import { formatMonthYear, formatNumber, parseLocalDate, toIsoDate } from '@/lib/format';
import { useThemeColors } from '@/theme/useThemeColors';

/** Without history (deep link / cold start), back goes to the calendar. */
const goBack = () => (router.canGoBack() ? router.back() : router.replace('/calendar'));

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** How many never-worn pieces the strip shows; the sentence above it gives the full count. */
const UNWORN_SHOWN = 8;

const itemImage = (item: Item) => (item.useOriginalImage ? item.originalImageUrl : item.imageUrl);
const openItem = (id: string) => router.push({ pathname: '/item/[id]', params: { id } });

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View className="flex-1 gap-0.5 rounded-card border border-line bg-paper p-3.5" accessible accessibilityLabel={`${value} ${label}`}>
      <Text variant="h2">{value}</Text>
      <Text variant="caption" tone="muted" numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

/**
 * 09 › Rapor — what the "Rapor" control on the calendar's month summary opens: the month read back from
 * the "Bunu giyiyorum" records the calendar already has (days logged, pieces and looks worn, the most worn
 * pieces, the occasions, and the pieces that stayed in the wardrobe). Nothing is fetched for it and no AI
 * is involved. A detail screen: no bottom menu.
 */
export default function MonthReportScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ month?: string }>();
  const month = params.month && MONTH.test(params.month) ? params.month : monthOf(toIsoDate(new Date()));

  const calendar = useCalendarMonth(month);
  const looks = useLooks();
  const items = useItems();
  const query = combineQueries(combineQueries(calendar, looks), items);

  return (
    <Screen bottom>
      <ScreenHeader leading="back" onLeadingPress={goBack} />
      <View className="gap-1.5 px-gutter pb-3.5 pt-1">
        <Text variant="eyebrow">{t('monthReport.eyebrow')}</Text>
        <Text variant="display" numberOfLines={1} adjustsFontSizeToFit>
          {formatMonthYear(parseLocalDate(`${month}-01`))}
        </Text>
      </View>
      <ScreenState
        query={query}
        isEmpty={({ a }) => a.a.wearLogs.length === 0}
        empty={{ message: t('monthReport.emptyMessage'), actionLabel: t('monthReport.emptyAction'), onAction: goBack }}
      >
        {({ a: { a: data, b: lookList }, b: itemList }) => {
          const report = buildMonthReport(month, data.wearLogs, lookList, itemList);
          const unworn = report.unworn.slice(0, UNWORN_SHOWN);
          return (
            <ScrollView
              contentContainerClassName="gap-6 pb-8"
              refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} tintColor={colors.muted} />}
            >
              <View className="gap-2 px-gutter">
                <View className="flex-row gap-2">
                  <Stat value={formatNumber(report.daysLogged)} label={t('monthReport.statDays', { count: report.daysLogged })} />
                  <Stat value={formatNumber(report.piecesWorn)} label={t('monthReport.statPieces', { count: report.piecesWorn })} />
                  <Stat value={formatNumber(report.looksWorn)} label={t('monthReport.statLooks', { count: report.looksWorn })} />
                </View>
                <Text variant="caption" tone="muted">
                  {t('monthReport.coverage', { logged: report.daysLogged, total: report.daysInMonth })}
                </Text>
              </View>

              {report.topItems.length > 0 ? (
                <View className="px-gutter">
                  <Text variant="h3" className="pb-1">
                    {t('monthReport.topItems')}
                  </Text>
                  {report.topItems.map(({ item, count }) => (
                    <Pressable
                      key={item.id}
                      onPress={() => openItem(item.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.name}, ${t('monthReport.wornTimes', { count })}`}
                      className="flex-row items-center gap-3 border-b border-line py-2 active:opacity-80"
                    >
                      <ItemThumb category={item.category} color={item.color} uri={itemImage(item)} className="h-16 w-[52px] rounded-thumb" glyphSize={22} />
                      <Text variant="body" className="flex-1" numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text variant="price">{t('monthReport.wornTimes', { count })}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {report.occasions.length > 0 ? (
                <View className="gap-2.5 px-gutter">
                  <Text variant="h3">{t('monthReport.occasions')}</Text>
                  <View className="flex-row flex-wrap gap-1.5">
                    {report.occasions.map((o) => (
                      <Badge key={o.occasion} label={t('weekPlan.occasionCount', { occasion: t(`occasion.${o.occasion}`), count: o.count })} />
                    ))}
                  </View>
                </View>
              ) : null}

              {/* An empty wardrobe has nothing to leave unworn. */}
              <View className="gap-2.5" style={itemList.length > 0 ? undefined : { display: 'none' }}>
                <View className="gap-1 px-gutter">
                  <Text variant="h3">{t('monthReport.unworn')}</Text>
                  <Text variant="body" tone="muted">
                    {report.unworn.length > 0 ? t('monthReport.unwornCount', { count: report.unworn.length }) : t('monthReport.allWorn')}
                  </Text>
                </View>
                {unworn.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2.5 px-gutter">
                    {unworn.map((item) => (
                      <Pressable
                        key={item.id}
                        onPress={() => openItem(item.id)}
                        accessibilityRole="button"
                        accessibilityLabel={item.name}
                        className="w-[88px] gap-1.5 active:opacity-80"
                      >
                        <ItemThumb category={item.category} color={item.color} uri={itemImage(item)} className="h-[110px] w-full rounded-image" glyphSize={28} />
                        <Text variant="caption" numberOfLines={2}>
                          {item.name}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : null}
              </View>
            </ScrollView>
          );
        }}
      </ScreenState>
    </Screen>
  );
}
