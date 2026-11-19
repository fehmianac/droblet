import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, CalendarX2, ChevronRight, Info, type LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { STYLIST_DISLIKE_REASONS, type StylistDislikeReason } from '@/api/contracts/stylist';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip, ChipWrap } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { formatDate, parseLocalDate, toIsoDate, weekdayShort } from '@/lib/format';
import { suffixed } from '@/lib/trSuffix';

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
  /** Days that already have a look planned: their chip carries a dot and picking one says the plan will change. */
  plannedDays?: ReadonlySet<string>;
  /** The day this suggestion is planned on ("Günü değiştir" preselects it). */
  currentDate?: string | null;
  onConfirm: (date: string) => void;
};

/**
 * "Takvime ekle" — pick the day; the suggestion becomes that day's plan only after this confirmation (canvas 13c A).
 * A day that already has a plan is marked, and choosing it says "O günün planı bu kombinle değişir."
 */
export function CalendarSheet({ visible, onClose, requestDate, plannedDays, currentDate = null, onConfirm }: CalendarProps) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string | null>(null);
  const date = picked ?? currentDate ?? defaultCalendarDate(requestDate);
  const replaces = Boolean(plannedDays?.has(date)) && date !== currentDate;
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('stylistResult.calendarTitle')}>
      <View className="gap-4">
        <ChipWrap>
          {calendarOptions(requestDate).map((iso) => {
            const d = parseLocalDate(iso);
            const label = t('stylistResult.dayA11y', { weekday: weekdayShort(d), date: formatDate(d, { day: 'numeric', month: 'short' }) });
            const busy = Boolean(plannedDays?.has(iso)) && iso !== currentDate;
            return (
              <Chip
                key={iso}
                label={label}
                dot={busy}
                accessibilityLabel={busy ? t('stylistResult.dayPlannedA11y', { day: label }) : label}
                selected={iso === date}
                onPress={() => setPicked(iso)}
                testID={`calendar-day-${iso}`}
              />
            );
          })}
        </ChipWrap>
        {replaces ? (
          <View className="flex-row items-center gap-2 rounded-image bg-cream px-3 py-2.5" accessibilityLiveRegion="polite" testID="calendar-replaces">
            <Icon icon={Info} size={16} tone="accent" />
            <Text variant="caption" tone="accent" className="flex-1">
              {t('stylistResult.calendarBody')}
            </Text>
          </View>
        ) : null}
        <Button
          label={t('stylistResult.calendarConfirm')}
          testID="calendar-confirm"
          onPress={() => {
            setPicked(null);
            onConfirm(date);
          }}
        />
      </View>
    </BottomSheet>
  );
}

type PlannedProps = {
  visible: boolean;
  onClose: () => void;
  /** The planned day (ISO). */
  date: string | null;
  onChangeDay: () => void;
  onRemove: () => void;
  onSeeWeek: () => void;
};

/** Canvas 13c C — the "Takvimde · Sal 24 Kas" button: change the day, take it off the calendar, or see the week. */
export function PlannedSheet({ visible, onClose, date, onChangeDay, onRemove, onSeeWeek }: PlannedProps) {
  const { t, i18n } = useTranslation();
  const longDay = date ? formatDate(parseLocalDate(date), { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  // "Salı 24 Kasım'da" / "On Tuesday 24 November".
  const day = longDay ? suffixed(longDay, 'locative', i18n.language.startsWith('tr') ? 'tr' : 'en') : '';
  const rows: { icon: LucideIcon; label: string; onPress: () => void; testID: string }[] = [
    { icon: CalendarDays, label: t('stylistResult.changeDay'), onPress: onChangeDay, testID: 'planned-change-day' },
    { icon: CalendarX2, label: t('stylistResult.removeFromCalendar'), onPress: onRemove, testID: 'planned-remove' },
    { icon: ChevronRight, label: t('stylistResult.seeWeek'), onPress: onSeeWeek, testID: 'planned-see-week' },
  ];
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('stylistResult.plannedOn', { date: day })}>
      <View>
        {rows.map((row, i) => (
          <Pressable
            key={row.testID}
            onPress={row.onPress}
            accessibilityRole="button"
            className={`min-h-[52px] flex-row items-center gap-3 active:opacity-70 ${i < rows.length - 1 ? 'border-b border-line' : ''}`}
            testID={row.testID}
          >
            <Icon icon={row.icon} size={18} />
            <Text variant="body" className="flex-1 text-[15px]">
              {row.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </BottomSheet>
  );
}
