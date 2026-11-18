import { router } from 'expo-router';
import { Bell, CalendarDays, ChevronRight, Cloud, Sparkles } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { extractApiError } from '@/api/errors';
import { useToday, useWearToday } from '@/api/today';
import { Logo } from '@/components/brand/Logo';
import { ImageTag } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { ImageSlot } from '@/components/ui/ImageSlot';
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

type DayPart = 'Morning' | 'Day' | 'Evening';

function dayPart(now: Date): DayPart {
  const h = now.getHours();
  if (h < 12) return 'Morning';
  if (h < 18) return 'Day';
  return 'Evening';
}

/**
 * 06 Bugün — logo + notifications, date · season + weather, greeting + today's occasion, 7-day strip,
 * today's outfit card (try-on image, pieces, missing piece → "Look'u tamamla", "Bunu giyiyorum",
 * another suggestion, heart) or the no-plan card (06 · plan yok), and this week's edit strip.
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
          const lang = currentLanguage();
          const meta = [formatLongDate(date, t), t(`season.${seasonOf(date)}`)].join(' · ');
          const look = data.look;
          const part = dayPart(new Date());
          // With a plan the greeting runs into the day's occasion ("Günaydın Damla, / bugün ofis günü.");
          // without one it stands alone ("Günaydın Damla.") — the no-plan card says the rest.
          const greeting =
            look && data.occasion
              ? `${t(`today.greeting${part}`, { name: data.firstName })}\n${t(`today.occasionLine.${data.occasion}`)}`
              : t(`todayHome.greetingAlone.${part}`, { name: data.firstName });
          return (
            <ScrollView
              contentContainerClassName="gap-[18px] pb-8 pt-1.5"
              refreshControl={
                <RefreshControl refreshing={today.isRefetching} onRefresh={() => void today.refetch()} tintColor={colors.muted} />
              }
            >
              <View className="gap-2 px-gutter">
                <View className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <Text variant="eyebrow">{toDisplayUpper(meta, lang)}</Text>
                  {data.weather ? (
                    <View className="flex-row items-center gap-1">
                      <Icon icon={Cloud} size={16} />
                      <Text variant="caption">
                        {t('todayHome.weather', { temperature: formatTemperature(data.weather.temperatureC), city: data.weather.city })}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text variant="display">{greeting}</Text>
              </View>

              <View className="px-gutter">
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
                  <View className="items-center gap-3.5 rounded-card border-[1.5px] border-dashed border-muted/60 px-6 py-8">
                    <View className="h-[72px] w-[72px] items-center justify-center rounded-pill bg-sand">
                      <Icon icon={CalendarDays} size={30} />
                    </View>
                    <Text variant="h2" className="text-center">
                      {t('todayHome.noPlanTitle')}
                    </Text>
                    <Text variant="body" tone="muted" className="text-center">
                      {t('todayHome.noPlanBody')}
                    </Text>
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
                    <Pressable
                      onPress={() => router.push({ pathname: '/edit/[id]', params: { id: 'current' } })}
                      accessibilityRole="link"
                      accessibilityLabel={t('todayHome.seeEdit')}
                      hitSlop={8}
                      className="min-h-icon-btn flex-row items-center gap-0.5 active:opacity-70"
                    >
                      <Text variant="label">{t('common.seeAll')}</Text>
                      <Icon icon={ChevronRight} size={14} />
                    </Pressable>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2.5 px-gutter">
                    {data.weeklyEdit.map((card) => {
                      const tag = toDisplayUpper(t('todayHome.editTag', { weekday: weekdayShort(parseLocalDate(card.date)), name: card.name }), lang);
                      return (
                        <Pressable
                          key={card.id}
                          onPress={() => router.push({ pathname: '/edit/[id]', params: { id: 'current', look: card.id } })}
                          accessibilityRole="button"
                          accessibilityLabel={t('todayHome.editCardA11y', { weekday: weekdayShort(parseLocalDate(card.date)), name: card.name })}
                          className="h-[190px] w-[140px] overflow-hidden rounded-image-lg active:opacity-80"
                        >
                          <ImageSlot uri={card.imageUrl} className="h-full w-full" placeholder={{ kind: 'look', pieces: [], seed: card.id, figureHeight: 117 }} />
                          <ImageTag label={tag} className="absolute bottom-2 left-2 max-w-[124px]" />
                        </Pressable>
                      );
                    })}
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
