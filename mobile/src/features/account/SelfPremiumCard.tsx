import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { isSelfPremiumDisabled, useSelfPremium } from '@/entitlement/selfPremium';
import { useEntitlement } from '@/entitlement/useEntitlement';

/**
 * 29 · GEÇİCİ ÜYELİK — temporary self-serve premium until store purchases are live (owner decision
 * 2026-11-19). Rendered only while the server switch is on (`selfServePremium.enabled`) and the account is
 * not already a member through the store (that membership is never replaced from here).
 */
export function SelfPremiumCard() {
  const { t } = useTranslation();
  const entitlement = useEntitlement();
  const toggle = useSelfPremium();
  const data = entitlement.data;
  const self = data?.selfServePremium;
  if (!data || !self?.enabled) return null;
  if (data.tier === 'member' && !self.active) return null;

  const active = self.active;
  const failed = toggle.isError;
  return (
    <>
      <Text variant="eyebrow">{t('selfPremium.eyebrow')}</Text>
      <View className="gap-2.5 rounded-card border border-line bg-paper px-3.5 py-3" testID="settings.selfPremium">
        <Text variant="bodyMedium">{t('selfPremium.title')}</Text>
        <Text variant="caption" tone="muted">
          {t(active ? 'selfPremium.bodyOn' : 'selfPremium.bodyOff')}
        </Text>
        <Button
          variant={active ? 'secondary' : 'primary'}
          size="md"
          label={t(active ? 'selfPremium.disable' : 'selfPremium.enable')}
          loading={toggle.isPending}
          onPress={() => {
            if (!toggle.isPending) toggle.mutate(!active);
          }}
          testID={active ? 'settings.selfPremium.disable' : 'settings.selfPremium.enable'}
        />
        {failed ? (
          <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
            {t(isSelfPremiumDisabled(toggle.error) ? 'selfPremium.disabledError' : 'selfPremium.error')}
          </Text>
        ) : null}
      </View>
    </>
  );
}
