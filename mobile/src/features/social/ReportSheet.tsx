import { X } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { REPORT_REASONS, type ReportReason } from '@/api/contracts/social';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Text } from '@/components/ui/Text';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { suffixed } from '@/lib/trSuffix';

import { useBlockPerson, useReportPerson } from './mutations';

type Props = {
  visible: boolean;
  onClose: () => void;
  handle: string;
  displayName: string;
  /** Called after the report was queued and the sheet closed (the profile confirms it). */
  onReported: () => void;
  /** Called after the person was blocked (the profile is no longer visible). */
  onBlocked: () => void;
};

/** One reason: 18 radio on the left, 44 high, hairline under every row but the last (as drawn). */
export function ReasonRow({ label, selected, last, onPress }: { label: string; selected: boolean; last: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      className={`min-h-icon-btn flex-row items-center gap-3 py-2 active:opacity-70 ${last ? '' : 'border-b border-line'}`}
    >
      <View
        className={`ml-1 h-[18px] w-[18px] items-center justify-center rounded-pill border ${selected ? 'border-ink' : 'border-muted'}`}
      >
        {selected ? <View className="h-2.5 w-2.5 rounded-pill bg-ink" /> : null}
      </View>
      <Text variant="body" className="flex-1">
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * 26b Şikayet et / Engelle (store rule for user content). Reporting is private and reviewed within
 * 24 hours; blocking takes effect at once and the other person is not told. Both are queued writes.
 * As on the canvas, sending the report closes the sheet (back on the profile, which confirms it)
 * and blocking leaves the profile.
 */
export function ReportSheet({ visible, onClose, handle, displayName, onReported, onBlocked }: Props) {
  const language = useAppLanguage();
  const { t } = useTranslation();
  const report = useReportPerson();
  const block = useBlockPerson();
  const [reason, setReason] = useState<ReportReason>('inappropriate');

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View className="gap-3 pb-3.5" accessibilityLabel={t('report.dialogA11y')}>
        <View className="flex-row items-center justify-between gap-3">
          <Text variant="h3" className="flex-1" accessibilityRole="header">
            {t('report.title', { name: suffixed(displayName, 'accusative', language) })}
          </Text>
          <IconButton icon={X} variant="plain" onPress={onClose} accessibilityLabel={t('a11y.close')} className="-mr-2.5" />
        </View>
        <Text variant="caption" tone="muted">
          {t('report.body')}
        </Text>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('report.reasonLabel')}>
          {REPORT_REASONS.map((r, index) => (
            <ReasonRow
              key={r}
              label={t(`report.reason.${r}`)}
              selected={reason === r}
              last={index === REPORT_REASONS.length - 1}
              onPress={() => setReason(r)}
            />
          ))}
        </View>
        <Button
          label={t('report.submit')}
          testID="report-submit"
          onPress={() => {
            report(handle, reason);
            onClose();
            onReported();
          }}
        />

        <View className="h-px bg-line" />
        <View className="flex-row items-start gap-3">
          <View className="flex-1">
            <Text variant="bodyMedium">{t('report.blockTitle')}</Text>
            <Text variant="caption" tone="muted">
              {t('report.blockBody', { name: displayName })}
            </Text>
          </View>
          {/* Canvas `.btn2` in the danger colour: outlined, 44 high — the word says what it does. */}
          <Pressable
            testID="report-block"
            onPress={() => {
              block(handle);
              onClose();
              onBlocked();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('report.blockA11y', { name: suffixed(displayName, 'accusative', language) })}
            className="h-btn-secondary items-center justify-center rounded-pill border border-danger px-[18px] active:opacity-70"
          >
            <Text variant="bodyMedium" tone="danger" numberOfLines={1}>
              {t('report.blockAction')}
            </Text>
          </Pressable>
        </View>
      </View>
    </BottomSheet>
  );
}
