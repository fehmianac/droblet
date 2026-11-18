import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { WeekDay } from '@/api/contracts';
import { Text } from '@/components/ui/Text';
import { formatDate, formatNumber, parseLocalDate, weekdayShort } from '@/lib/format';

/**
 * 7-day strip (06): paper cells 58 high with a 14 radius and a hairline; today filled ink; a 4 pt dot
 * under planned days. Tap → 07 with that day's week.
 */
export function WeekStrip({ week, today }: { week: WeekDay[]; today: string }) {
  const { t } = useTranslation();
  return (
    <View className="flex-row gap-1.5">
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
            hitSlop={{ top: 4, bottom: 4 }}
            className={`h-[58px] flex-1 items-center justify-center gap-0.5 rounded-image-lg active:opacity-80 ${
              isToday ? 'bg-ink' : 'border border-line bg-paper'
            }`}
          >
            <Text variant="badge" tone={isToday ? 'cream' : 'muted'} className="font-sans" maxFontSizeMultiplier={1.3}>
              {weekday}
            </Text>
            <Text variant="bodyMedium" tone={isToday ? 'cream' : 'ink'} className="text-[16px] leading-[20px]" maxFontSizeMultiplier={1.3}>
              {day}
            </Text>
            <View className={`h-1 w-1 rounded-pill ${d.hasPlan ? (isToday ? 'bg-cream' : 'bg-accent') : 'bg-transparent'}`} />
          </Pressable>
        );
      })}
    </View>
  );
}
