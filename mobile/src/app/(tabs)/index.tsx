import { router } from 'expo-router';
import { Bell, CloudSun, Sparkles } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, View } from 'react-native';

import { extractApiError } from '@/api/errors';
import { useToday, useWearToday } from '@/api/today';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { LookCard } from '@/components/ui/LookCard';
import { Screen } from '@/components/ui/Screen';
import { ScreenState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { useRefreshTodayLook, useSetLookFavorite } from '@/features/today/api';
import { TodayLookCard } from '@/features/today/TodayLookCard';
import { TodaySkeleton } from '@/features/today/TodaySkeleton';
import { WeekStrip } from '@/features/today/WeekStrip';
import { currentLanguage } from '@/i18n';
import { formatLongDate, formatTemperature, parseLocalDate, seasonOf, weekdayShort } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';
import { useThemeColors } from '@/theme/useThemeColors';

function greetingKey(now: Date): 'today.greetingMorning' | 'today.greetingDay' | 'today.greetingEvening' {
  const h = now.getHours();
  if (h < 12) return 'today.greetingMorning';
  if (h < 18) return 'today.greetingDay';
  return 'today.greetingEvening';
}

/**
 * 06 Bugün — logo + notifications, date · season + weather, greeting + today's occasion, 7-day strip,
 * today's outfit card (try-on image, pieces, missing piece → "Look'u tamamla", "Bunu giyiyorum",
 * another suggestion, heart) or the no-plan state, and this week's edit strip.
 */
export default function TodayScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const today = useToday();
  const wear = useWearToday();
  const favorite = useSetLookFavorite();
  const refresh = useRefreshTodayLook();

  return (
    <Screen>
      <View className="h-12 flex-row items-center justify-between px-gutter">
        <Logo />
        <IconButton icon={Bell} onPress={() => router.push('/notifications')} accessibilityLabel={t('todayHome.notifications')} />
      </View>
      <ScreenState query={today} skeleton={<TodaySkeleton />}>
        {(data) => {
          const date = parseLocalDate(data.date);
          const meta = [formatLongDate(date, t), t(`season.${seasonOf(date)}`)].join(' · ');
          const look = data.look;
          return (
            <ScrollView
              contentContainerClassName="gap-7 pb-8 pt-2"
              refreshControl={
                <RefreshControl refreshing={today.isRefetching} onRefresh={() => void today.refetch()} tintColor={colors.muted} />
              }
            >
              <View className="gap-4 px-gutter">
                <View className="gap-1">
                  <View className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <Text variant="eyebrow">{toDisplayUpper(meta, currentLanguage())}</Text>
                    {data.weather ? (
                      <View className="flex-row items-center gap-1">
                        <Icon icon={CloudSun} size={14} tone="muted" />
                        <Text variant="caption" tone="muted">
                          {t('todayHome.weather', { temperature: formatTemperature(data.weather.temperatureC), city: data.weather.city })}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text variant="display">{t(greetingKey(new Date()), { name: data.firstName })}</Text>
                  <Text variant="display" tone="muted">
                    {t(`today.occasionLine.${data.occasion ?? 'none'}`)}
                  </Text>
                </View>
                <WeekStrip week={data.week} today={data.date} />
              </View>

              <View className="gap-2 px-gutter">
                {look ? (
                  <TodayLookCard
                    look={look}
                    onWear={() => wear.wear(look.id)}
                    onRefresh={() => refresh.mutate(data.date)}
                    refreshing={refresh.isPending}
                    onToggleFavorite={() => favorite.set(look.id, !look.isFavorite)}
                  />
                ) : (
                  <View className="items-center gap-4 rounded-card border border-dashed border-line px-6 py-8">
                    <Icon icon={Sparkles} size={28} tone="accent" />
                    <View className="gap-1.5">
                      <Text variant="h2" className="text-center">
                        {t('todayHome.noPlanTitle')}
                      </Text>
                      <Text variant="body" tone="muted" className="text-center">
                        {t('todayHome.noPlanBody')}
                      </Text>
                    </View>
                    <Button
                      label={t('todayHome.noPlanAction')}
                      icon={Sparkles}
                      onPress={() => router.navigate({ pathname: '/stylist', params: { date: data.date } })}
                      className="self-stretch"
                    />
                  </View>
                )}
                {refresh.isError ? (
                  <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
                    {extractApiError(refresh.error) === 'unknown' ? t('todayHome.refreshFailed') : t(`errors.${extractApiError(refresh.error)}`)}
                  </Text>
                ) : null}
              </View>

              {data.weeklyEdit.length > 0 ? (
                <View className="gap-3">
                  <View className="flex-row items-center justify-between gap-3 px-gutter">
                    <Text variant="h3" className="flex-1" numberOfLines={1}>
                      {t('today.weeklyEdit')}
                    </Text>
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
                        onPress={() => router.push({ pathname: '/edit/[id]', params: { id: 'current', look: card.id } })}
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
