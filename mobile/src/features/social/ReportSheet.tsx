import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { REPORT_REASONS, type ReportReason } from '@/api/contracts/social';
import { Card } from '@/components/blocks/basics';
import { RadioRow } from '@/components/blocks/rows';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { currentLanguage } from '@/i18n';
import { suffixed } from '@/lib/trSuffix';

import { useBlockPerson, useReportPerson } from './mutations';

type Props = {
  visible: boolean;
  onClose: () => void;
  handle: string;
  displayName: string;
  /** Called after the person was blocked (the profile is no longer visible). */
  onBlocked: () => void;
};

/**
 * 26b Şikayet et / Engelle (store rule for user content). Reporting is private and reviewed within
 * 24 hours; blocking takes effect at once and the other person is not told. Both are queued writes.
 */
export function ReportSheet({ visible, onClose, handle, displayName, onBlocked }: Props) {
  const { t } = useTranslation();
  const report = useReportPerson();
  const block = useBlockPerson();
  const [reason, setReason] = useState<ReportReason>('inappropriate');
  const [sent, setSent] = useState(false);

  const close = () => {
    setSent(false);
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={close} title={t('report.title', { name: suffixed(displayName, 'accusative', currentLanguage()) })}>
      <View className="gap-4" accessibilityLabel={t('report.dialogA11y')}>
        {sent ? (
          <>
            <Text variant="body" accessibilityLiveRegion="polite">
              {t('report.sent')}
            </Text>
            <Button label={t('common.ok')} onPress={close} />
          </>
        ) : (
          <>
            <Text variant="body" tone="muted">
              {t('report.body')}
            </Text>
            <Card>
              <View accessibilityRole="radiogroup" accessibilityLabel={t('report.reasonLabel')}>
                {REPORT_REASONS.map((r, index) => (
                  <RadioRow key={r} first={index === 0} label={t(`report.reason.${r}`)} selected={reason === r} onPress={() => setReason(r)} />
                ))}
              </View>
            </Card>
            <Button
              label={t('report.submit')}
              onPress={() => {
                report(handle, reason);
                setSent(true);
              }}
            />
          </>
        )}

        <View className="h-px bg-line" />
        <View className="flex-row items-center gap-3">
          <View className="flex-1 gap-0.5">
            <Text variant="bodyMedium">{t('report.blockTitle')}</Text>
            <Text variant="caption" tone="muted">
              {t('report.blockBody', { name: displayName })}
            </Text>
          </View>
          <Button
            variant="secondary"
            label={t('report.blockAction')}
            onPress={() => {
              block(handle);
              close();
              onBlocked();
            }}
          />
        </View>
      </View>
    </BottomSheet>
  );
}
