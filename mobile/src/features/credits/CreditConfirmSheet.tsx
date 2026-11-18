import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';

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
  const eyebrow = scope ? t('credits.eyebrowScoped', { scope }) : t('credits.eyebrow');

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View className="gap-4">
        <View className="gap-1.5">
          <Text variant="eyebrow">{eyebrow}</Text>
          <Text variant="h2">{t('credits.willSpend', { count: cost })}</Text>
          <Text variant="body" tone="muted">
            {t('credits.explain', { count: cost })}
          </Text>
        </View>

        {remaining !== null ? (
          <View className="gap-2.5 rounded-card border border-line bg-paper p-4">
            <Row label={t('credits.remainingNow')} value={t('credits.images', { count: remaining })} />
            <Row label={t('credits.thisAction')} value={`−${cost}`} />
            <View className="h-px bg-line" />
            <Row
              label={t('credits.afterwards')}
              value={affordable ? t('credits.images', { count: remaining - cost }) : t('credits.notEnough')}
              strong
              danger={!affordable}
            />
          </View>
        ) : null}

        <Text variant="caption" tone="muted">
          {t('credits.cacheNote')}
        </Text>

        <View className="gap-2">
          {affordable ? (
            <Button label={t('credits.confirm', { count: cost })} onPress={onConfirm} loading={confirming} testID="credit-confirm" />
          ) : (
            <Button
              label={t(credits.isMember ? 'credits.topUp' : 'credits.becomeMember')}
              disabled={credits.isLoading}
              onPress={() => {
                onClose();
                openCreditTopUp(credits.isMember);
              }}
            />
          )}
          <Button variant="secondary" label={t('common.cancel')} onPress={onClose} />
        </View>
      </View>
    </BottomSheet>
  );
}

function Row({ label, value, strong = false, danger = false }: { label: string; value: string; strong?: boolean; danger?: boolean }) {
  return (
    <View className="flex-row items-center justify-between gap-3" accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant={strong ? 'bodyMedium' : 'body'} tone={strong ? 'ink' : 'muted'} className="flex-1">
        {label}
      </Text>
      <Text variant="bodyMedium" tone={danger ? 'danger' : 'ink'}>
        {value}
      </Text>
    </View>
  );
}
