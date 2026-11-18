import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { WeekDay } from '@/api/contracts';
import { Text } from '@/components/ui/Text';
import { formatDate, formatNumber, parseLocalDate, weekdayShort } from '@/lib/format';

/** 7-day strip: today filled ink, a dot under planned days; tap → 07 with that day selected. */
export function WeekStrip({ week, today }: { week: WeekDay[]; today: string }) {
  const { t } = useTranslation();
  return (
    <View className="flex-row justify-between gap-1">
      {week.map((d) => {
        const date = parseLocalDate(d.date);
        const isToday = d.date === today;
        const weekday = weekdayShort(date);
        const day = formatNumber(date.getDate());
        const label = isToday
          ? t('a11y.dayToday', { weekday, day })
          : d.hasPlan
            ? t('a11y.dayPlanned', { weekday, day })
            : formatDate(date, { weekday: 'long', day: 'numeric' });
        return (
          <Pressable
            key={d.date}
            onPress={() => router.push({ pathname: '/plan/week', params: { day: d.date } })}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: isToday }}
            className={`min-h-16 flex-1 items-center justify-center gap-1 rounded-pill py-2 ${isToday ? 'bg-ink' : ''}`}
          >
            <Text variant="caption" tone={isToday ? 'paper' : 'muted'} maxFontSizeMultiplier={1.3}>
              {weekday}
            </Text>
            <Text variant="bodyMedium" tone={isToday ? 'paper' : 'ink'} maxFontSizeMultiplier={1.3}>
              {day}
            </Text>
            <View className={`h-1 w-1 rounded-pill ${d.hasPlan ? (isToday ? 'bg-paper' : 'bg-accent') : 'bg-transparent'}`} />
          </Pressable>
        );
      })}
    </View>
  );
}
