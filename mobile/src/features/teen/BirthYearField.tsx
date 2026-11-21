import { ChevronDown } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { currentLocaleTag } from '@/i18n';

import { birthYears } from './age';

const ROW = 44;

/** The month names of the app language ("Nisan" / "April"). */
function monthName(month: number): string {
  return new Date(2000, month - 1, 1).toLocaleString(currentLocaleTag(), { month: 'long' });
}

function PickerField({
  label,
  value,
  onPress,
  error,
  testID,
}: {
  label: string;
  value: string | null;
  onPress: () => void;
  error?: string | null;
  testID: string;
}) {
  const { t } = useTranslation();
  return (
    <View className="gap-1.5">
      <Text variant="label">{label}</Text>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value ?? t('teen.birth.choose')}`}
        accessibilityHint={error ?? undefined}
        testID={testID}
        className={`h-field flex-row items-center gap-2.5 rounded-field border bg-paper px-3.5 active:opacity-80 ${error ? 'border-danger' : 'border-line'}`}
      >
        <Text variant="body" tone={value ? 'ink' : 'muted'} className="flex-1 text-[15px]">
          {value ?? t('teen.birth.choose')}
        </Text>
        <Icon icon={ChevronDown} size={18} />
      </Pressable>
    </View>
  );
}

/** A list sheet of options with one selected row and "Seç" (canvas 18 · 02f sheet). */
function ChoiceSheet<T extends number>({
  visible,
  title,
  note,
  options,
  initial,
  label,
  onClose,
  onPick,
  testID,
}: {
  visible: boolean;
  title: string;
  note?: string;
  options: T[];
  initial: T | null;
  label: (v: T) => string;
  onClose: () => void;
  onPick: (v: T) => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<T | null>(initial);
  const start = Math.max(0, options.indexOf((selected ?? initial ?? options[0]) as T) - 2);
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <View className="gap-3">
        <ScrollView
          style={{ maxHeight: ROW * 5 + 8 }}
          contentOffset={{ x: 0, y: start * (ROW + 2) }}
          accessibilityRole="list"
          testID={`${testID}.list`}
        >
          {options.map((o) => {
            const on = o === selected;
            return (
              <Pressable
                key={o}
                onPress={() => setSelected(o)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={label(o)}
                testID={`${testID}.option.${o}`}
                className={`mb-0.5 h-11 items-center justify-center rounded-field ${on ? 'bg-sand' : ''}`}
              >
                <Text variant={on ? 'bodyMedium' : 'body'} tone={on ? 'ink' : 'muted'} className="text-[17px]">
                  {label(o)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {note ? (
          <Text variant="caption" tone="muted">
            {note}
          </Text>
        ) : null}
        <Button
          label={t('teen.birth.select')}
          disabled={selected === null}
          onPress={() => {
            if (selected !== null) onPick(selected);
          }}
          testID={`${testID}.select`}
        />
      </View>
    </BottomSheet>
  );
}

type Props = {
  year: number | null;
  month: number | null;
  showMonth: boolean;
  onYear: (year: number) => void;
  onMonth: (month: number) => void;
  /** Line under the year field (canvas 02: the empty and the teen hint). */
  hint?: string | null;
  yearError?: string | null;
  monthError?: string | null;
};

/**
 * "Doğum yılın" (canvas 18 · 02 / 02f) instead of the 18+ box: a field that opens the year sheet (newest first), and
 * "Doğum ayın" only when the year alone cannot tell the band (docs/api/teen.md §3).
 */
export function BirthYearField({ year, month, showMonth, onYear, onMonth, hint, yearError, monthError }: Props) {
  const { t } = useTranslation();
  const [sheet, setSheet] = useState<'year' | 'month' | null>(null);
  const years = birthYears();
  return (
    <View className="gap-3">
      <View className="gap-1.5">
        <PickerField
          label={t('teen.birth.label')}
          value={year ? String(year) : null}
          onPress={() => setSheet('year')}
          error={yearError}
          testID="birth.year"
        />
        {yearError ? (
          <Text variant="caption" tone="danger" accessibilityRole="alert" testID="birth.year.error">
            {yearError}
          </Text>
        ) : hint ? (
          <Text variant="caption" tone="muted" testID="birth.hint">
            {hint}
          </Text>
        ) : null}
      </View>
      {showMonth ? (
        <View className="gap-1.5">
          <PickerField
            label={t('teen.birth.monthLabel')}
            value={month ? monthName(month) : null}
            onPress={() => setSheet('month')}
            error={monthError}
            testID="birth.month"
          />
          <Text variant="caption" tone={monthError ? 'danger' : 'muted'} testID="birth.month.hint">
            {monthError ?? t('teen.birth.monthHint')}
          </Text>
        </View>
      ) : null}
      {sheet === 'year' ? (
        <ChoiceSheet
          visible
          title={t('teen.birth.sheetTitle')}
          note={t('teen.birth.sheetNote')}
          options={years}
          initial={year ?? years[6] ?? null}
          label={(v) => String(v)}
          onClose={() => setSheet(null)}
          onPick={(v) => {
            setSheet(null);
            onYear(v);
          }}
          testID="birth.yearSheet"
        />
      ) : null}
      {sheet === 'month' ? (
        <ChoiceSheet
          visible
          title={t('teen.birth.monthSheetTitle')}
          options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]}
          initial={month}
          label={monthName}
          onClose={() => setSheet(null)}
          onPick={(v) => {
            setSheet(null);
            onMonth(v);
          }}
          testID="birth.monthSheet"
        />
      ) : null}
    </View>
  );
}
