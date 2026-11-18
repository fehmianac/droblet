import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Text, type TextTone } from '@/components/ui/Text';

import { openCreditTopUp, useAiCredits } from './useAiCredits';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Number of images that will be generated (1 credit each). */
  cost: number;
  /** Upper-case scope for the eyebrow, e.g. "TÜM HAFTA" (already upper-case / via toDisplayUpper). Optional. */
  scope?: string;
  /** Called when the user accepts the spend. Start the try-on job(s) here. */
  onConfirm: () => void;
  confirming?: boolean;
};

/**
 * 07b Kredi onayı — shown before every "Üzerimde gör" that spends credits: what it costs, what is
 * left now and after. When the balance is too low (or the user is not a member) the single action
 * becomes "Kredi yükle" / "Üye ol" instead — never a silent failure.
 */
export function CreditConfirmSheet({ visible, onClose, cost, scope, onConfirm, confirming = false }: Props) {
  const { t } = useTranslation();
  const credits = useAiCredits();
  const remaining = credits.remaining;
  const affordable = credits.isMember && credits.canAfford(cost);
  const eyebrow = scope ? t('creditConfirm.eyebrowScoped', { scope }) : t('creditConfirm.eyebrow');

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {/* The sheet insets 20; the board draws this one at 24. */}
      <View className="gap-[18px] px-1 pb-1">
        <View className="gap-2">
          <Text variant="eyebrow">{eyebrow}</Text>
          <Text variant="h2">{t('creditConfirm.willSpend', { count: cost })}</Text>
          <Text variant="body" tone="muted">
            {t('creditConfirm.explain', { count: cost })}
          </Text>
        </View>

        {remaining !== null ? (
          <View className="gap-2.5 rounded-card border border-line bg-paper px-4 py-3.5">
            <Row label={t('creditConfirm.remainingNow')} value={t('creditConfirm.images', { count: remaining })} />
            <Row label={t('creditConfirm.thisAction')} value={`−${cost}`} tone="accent" />
            <View className="h-px bg-line" />
            <Row
              label={t('creditConfirm.afterwards')}
              value={affordable ? t('creditConfirm.images', { count: remaining - cost }) : t('creditConfirm.notEnough')}
              tone={affordable ? 'ink' : 'danger'}
            />
          </View>
        ) : null}

        <Text variant="caption" tone="muted" className="leading-[18px]">
          {t('creditConfirm.cacheNote')}
        </Text>

        <View className="gap-1.5">
          {affordable ? (
            <Button label={t('creditConfirm.confirm', { count: cost })} onPress={onConfirm} loading={confirming} testID="credit-confirm" />
          ) : (
            <Button
              label={t(credits.isMember ? 'creditConfirm.topUp' : 'creditConfirm.becomeMember')}
              disabled={credits.isLoading}
              onPress={() => {
                onClose();
                openCreditTopUp(credits.isMember);
              }}
            />
          )}
          <Button variant="text" label={t('common.cancel')} onPress={onClose} />
        </View>
      </View>
    </BottomSheet>
  );
}

/** One line of the balance card: 14 regular label, 14 medium value. */
function Row({ label, value, tone = 'ink' }: { label: string; value: string; tone?: TextTone }) {
  return (
    <View className="flex-row items-center justify-between gap-3" accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="body" className="flex-1">
        {label}
      </Text>
      <Text variant="bodyMedium" tone={tone}>
        {value}
      </Text>
    </View>
  );
}
