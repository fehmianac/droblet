import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { STYLIST_DISLIKE_REASONS, type StylistDislikeReason } from '@/api/contracts/stylist';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip, ChipWrap } from '@/components/ui/Chip';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { formatDate, parseLocalDate, toIsoDate, weekdayShort } from '@/lib/format';

type FeedbackProps = {
  visible: boolean;
  onClose: () => void;
  onSubmit: (reasons: StylistDislikeReason[], note: string) => void;
};

/** "Neyi beğenmedin?" — reason chips (any number, none is fine) + an optional note, then the next suggestion. */
export function FeedbackSheet({ visible, onClose, onSubmit }: FeedbackProps) {
  const { t } = useTranslation();
  const [reasons, setReasons] = useState<StylistDislikeReason[]>([]);
  const [note, setNote] = useState('');
  const toggle = (r: StylistDislikeReason) => setReasons((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('stylistFeedback.title')}>
      <View className="gap-4">
        <Text variant="caption" tone="muted">
          {t('stylistFeedback.body')}
        </Text>
        <ChipWrap>
          {STYLIST_DISLIKE_REASONS.map((r) => (
            <Chip key={r} label={t(`stylistFeedback.reason.${r}`)} selected={reasons.includes(r)} onPress={() => toggle(r)} />
          ))}
        </ChipWrap>
        <TextField
          label={t('stylistFeedback.noteLabel')}
          placeholder={t('stylistFeedback.notePlaceholder')}
          value={note}
          onChangeText={setNote}
          maxLength={200}
        />
        <Button
          label={t('stylistFeedback.submit')}
          testID="feedback-submit"
          onPress={() => {
            onSubmit(reasons, note);
            setReasons([]);
            setNote('');
          }}
        />
      </View>
    </BottomSheet>
  );
}

/** Today + the next six days; the requested day is added when it lies further ahead. */
export function calendarOptions(requestDate: string, today: Date = new Date()): string[] {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return toIsoDate(d);
  });
  const first = days[0] ?? requestDate;
  return requestDate > (days[6] ?? first) ? [...days, requestDate] : days;
}

/** The day preselected in the sheet: the requested day unless it is already past. */
export function defaultCalendarDate(requestDate: string, today: Date = new Date()): string {
  const todayIso = toIsoDate(today);
  return requestDate >= todayIso ? requestDate : todayIso;
}

type CalendarProps = {
  visible: boolean;
  onClose: () => void;
  /** The day the outfit was asked for. */
  requestDate: string;
  onConfirm: (date: string) => void;
};

/** "Takvime ekle" — pick the day; the suggestion becomes that day's plan only after this confirmation. */
export function CalendarSheet({ visible, onClose, requestDate, onConfirm }: CalendarProps) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string | null>(null);
  const date = picked ?? defaultCalendarDate(requestDate);
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('stylistResult.calendarTitle')}>
      <View className="gap-4">
        <Text variant="caption" tone="muted">
          {t('stylistResult.calendarBody')}
        </Text>
        <ChipWrap>
          {calendarOptions(requestDate).map((iso) => {
            const d = parseLocalDate(iso);
            return (
              <Chip
                key={iso}
                label={t('stylistResult.dayA11y', { weekday: weekdayShort(d), date: formatDate(d, { day: 'numeric', month: 'short' }) })}
                selected={iso === date}
                onPress={() => setPicked(iso)}
              />
            );
          })}
        </ChipWrap>
        <Button label={t('stylistResult.calendarConfirm')} testID="calendar-confirm" onPress={() => onConfirm(date)} />
      </View>
    </BottomSheet>
  );
}
