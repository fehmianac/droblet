import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Text } from '@/components/ui/Text';
import { formatDate, formatMonthYear, parseLocalDate, toIsoDate, weekdayShort } from '@/lib/format';

import { monthGrid, pickRangeDate } from './logic';

export type DateRange = { start: string | null; end: string | null };
export type RangeField = 'start' | 'end';

type Props = {
  /** Which end is being picked; null = closed. */
  field: RangeField | null;
  range: DateRange;
  /** Earliest selectable day (ISO), usually today. */
  minDate: string;
  onChange: (range: DateRange) => void;
  onClose: () => void;
};

/** Monday-first week; the labels come from Intl for the active language (2024-01-01 was a Monday). */
function weekdayLabels(): string[] {
  return Array.from({ length: 7 }, (_, i) => weekdayShort(new Date(2024, 0, 1 + i)));
}

function Body({ field: initialField, range, minDate, onChange, onClose }: Props & { field: RangeField }) {
  const { t } = useTranslation();
  const [field, setField] = useState<RangeField>(initialField);
  const anchor = parseLocalDate((initialField === 'end' ? (range.end ?? range.start) : range.start) ?? minDate);
  const [month, setMonth] = useState({ year: anchor.getFullYear(), month: anchor.getMonth() });
  const min = parseLocalDate(minDate);
  const canGoBack = month.year > min.getFullYear() || (month.year === min.getFullYear() && month.month > min.getMonth());
  const shift = (delta: number) => {
    const d = new Date(month.year, month.month + delta, 1);
    setMonth({ year: d.getFullYear(), month: d.getMonth() });
  };
  const weeks = monthGrid(month.year, month.month);

  const pick = (date: string) => {
    const next = pickRangeDate(range, field, date);
    onChange(next);
    if (next.end === null) setField('end');
    else if (field === 'end') onClose();
    else setField('end');
  };

  return (
    <View className="gap-3">
      <Text variant="h3">{t(field === 'start' ? 'tripNew.pickerTitleStart' : 'tripNew.pickerTitleEnd')}</Text>
      <View className="flex-row items-center justify-between">
        <IconButton icon={ChevronLeft} variant="plain" onPress={() => shift(-1)} disabled={!canGoBack} accessibilityLabel={t('tripNew.prevMonth')} />
        <Text variant="bodyMedium" accessibilityLiveRegion="polite">
          {formatMonthYear(new Date(month.year, month.month, 1))}
        </Text>
        <IconButton icon={ChevronRight} variant="plain" onPress={() => shift(1)} accessibilityLabel={t('tripNew.nextMonth')} />
      </View>
      <View className="flex-row" accessible={false} importantForAccessibility="no-hide-descendants">
        {weekdayLabels().map((label, i) => (
          <View key={i} className="flex-1 items-center">
            <Text variant="caption" tone="muted" numberOfLines={1} maxFontSizeMultiplier={1.2}>
              {label}
            </Text>
          </View>
        ))}
      </View>
      <View className="gap-1">
        {weeks.map((week, w) => (
          <View key={w} className="flex-row">
            {week.map((date, i) => {
              if (!date) return <View key={i} className="h-11 flex-1" />;
              const disabled = date < minDate;
              const isEdge = date === range.start || date === range.end;
              const inRange = Boolean(range.start && range.end && date > range.start && date < range.end);
              const label = formatDate(parseLocalDate(date), { weekday: 'long', day: 'numeric', month: 'long' });
              return (
                <Pressable
                  key={date}
                  onPress={() => pick(date)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={isEdge ? t('tripNew.daySelected', { date: label }) : label}
                  accessibilityState={{ selected: isEdge, disabled }}
                  className={`h-11 flex-1 items-center justify-center ${inRange ? 'bg-sand' : ''}`}
                >
                  <View className={`h-10 w-10 items-center justify-center rounded-pill ${isEdge ? 'bg-ink' : ''} ${disabled ? 'opacity-30' : ''}`}>
                    <Text variant="bodyMedium" tone={isEdge ? 'paper' : 'ink'} maxFontSizeMultiplier={1.2}>
                      {formatDate(parseLocalDate(date), { day: 'numeric' })}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
      <Button variant="secondary" label={t('tripNew.done')} onPress={onClose} />
    </View>
  );
}

/**
 * In-app date range picker (18): a month grid in a bottom sheet. Picking the departure moves on to
 * the return; a return before the departure becomes the new departure. No native dependency.
 */
export function DateRangePicker(props: Props) {
  const { field, onClose } = props;
  return (
    <BottomSheet visible={field !== null} onClose={onClose}>
      {field ? <Body key={field} {...props} field={field} /> : null}
    </BottomSheet>
  );
}

export function todayIso(): string {
  return toIsoDate(new Date());
}
