import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, View } from 'react-native';

import type { TodayResponse } from '@/api/contracts';
import { useToday, useWearToday } from '@/api/today';
import { Button } from '@/components/ui/Button';
import { LookCard } from '@/components/ui/LookCard';
import { Screen } from '@/components/ui/Screen';
import { ScreenState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { TodayLookCard } from '@/features/today/TodayLookCard';
import { TodaySkeleton } from '@/features/today/TodaySkeleton';
import { WeekStrip } from '@/features/today/WeekStrip';
import { currentLanguage } from '@/i18n';
import { formatLongDate, parseLocalDate, seasonOf, weekdayShort } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';
import { queryKeys } from '@/sync/queryKeys';
import { useThemeColors } from '@/theme/useThemeColors';

function greetingKey(now: Date): 'today.greetingMorning' | 'today.greetingDay' | 'today.greetingEvening' {
  const h = now.getHours();
  if (h < 12) return 'today.greetingMorning';
  if (h < 18) return 'today.greetingDay';
  return 'today.greetingEvening';
}

/**
 * 06 Bugün — date · season · weather, personal greeting + today's occasion, 7-day strip, today's
 * outfit card ("Senin üzerinde", "Bunu giyiyorum") or the no-plan state, and this week's edit strip.
 * Data is fixture-backed behind `useToday` until the E4 contract exists.
 */
export default function TodayScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const client = useQueryClient();
  const today = useToday();
  const wear = useWearToday();

  const toggleFavorite = () =>
    client.setQueryData<TodayResponse>(queryKeys.today, (prev) =>
      prev?.look ? { ...prev, look: { ...prev.look, isFavorite: !prev.look.isFavorite } } : prev,
    );

  return (
    <Screen>
      <ScreenState query={today} skeleton={<TodaySkeleton />}>
        {(data) => {
          const date = parseLocalDate(data.date);
          const meta = [
            formatLongDate(date, t),
            t(`season.${seasonOf(date)}`),
            data.weather ? `${data.weather.temperatureC}° ${data.weather.city}` : null,
          ]
            .filter(Boolean)
            .join(' · ');

          return (
            <ScrollView
              contentContainerClassName="gap-7 pb-8 pt-2"
              refreshControl={
                <RefreshControl refreshing={today.isRefetching} onRefresh={() => void today.refetch()} tintColor={colors.muted} />
              }
            >
              <View className="gap-4 px-gutter">
                <Text variant="brand" tone="ink">
                  {t('brand.wordmark')}
                </Text>
                <View className="gap-1">
                  <Text variant="eyebrow">{toDisplayUpper(meta, currentLanguage())}</Text>
                  <Text variant="display">{t(greetingKey(new Date()), { name: data.firstName })}</Text>
                  <Text variant="display" tone="muted">
                    {t(`today.occasionLine.${data.occasion ?? 'none'}`)}
                  </Text>
                </View>
                <WeekStrip week={data.week} today={data.date} />
              </View>

              <View className="px-gutter">
                {data.look ? (
                  <TodayLookCard
                    look={data.look}
                    onWear={() => data.look && wear.wear(data.look.id)}
                    onRefresh={() => void today.refetch()}
                    refreshing={today.isRefetching}
                    onToggleFavorite={toggleFavorite}
                  />
                ) : (
                  <View className="items-center gap-4 rounded-card border border-dashed border-line p-6">
                    <Text variant="h3" className="text-center">
                      {t('today.noPlanTitle')}
                    </Text>
                    <Button variant="secondary" label={t('today.noPlanAction')} onPress={() => router.navigate('/stylist')} />
                  </View>
                )}
              </View>

              {data.weeklyEdit.length > 0 ? (
                <View className="gap-3">
                  <View className="flex-row items-center justify-between px-gutter">
                    <Text variant="h3">{t('today.weeklyEdit')}</Text>
                    <Button
                      variant="text"
                      label={t('common.seeAll')}
                      onPress={() => router.push({ pathname: '/edit/[id]', params: { id: 'current' } })}
                    />
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 px-gutter">
                    {data.weeklyEdit.map((card) => (
                      <LookCard
                        key={card.id}
                        className="w-36"
                        tag={weekdayShort(parseLocalDate(card.date))}
                        name={card.name}
                        imageUri={card.imageUrl}
                        onPress={() => router.push({ pathname: '/edit/[id]', params: { id: card.id } })}
                      />
                    ))}
                  </ScrollView>
                </View>
              ) : null}
            </ScrollView>
          );
        }}
      </ScreenState>
    </Screen>
  );
}
