import { Check, FileText } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { setProductAnalyticsEnabled, useProductAnalyticsEnabled } from '@/analytics/preference';
import { track } from '@/analytics/track';
import { openPrivacy } from '@/components/LegalLinks';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';

import { ProfileMenuRow, RowCard } from './rows';

/**
 * 29d Gizlilik — "Ürün analitiği": on by default (legitimate interest, privacy notice); switching it off
 * stops Firebase Analytics on this phone at once. Our own first-party analytics is not affected. Drawn as
 * the consent rows (title + 12 muted line + 20 pt check box), with "Gizlilik bildirimi" under it.
 */
export function ProductAnalyticsCard() {
  const { t } = useTranslation();
  const enabled = useProductAnalyticsEnabled();
  const title = t('productAnalytics.title');

  const toggle = () => {
    const next = !enabled;
    void setProductAnalyticsEnabled(next).then(() =>
      // Off: Firebase is already off, so only our own analytics hears it.
      track('consent_updated', { type: 'product_analytics', granted: next, source: 'settings' }),
    );
  };

  return (
    <RowCard>
      <Pressable
        onPress={toggle}
        accessibilityRole="switch"
        accessibilityLabel={title}
        accessibilityHint={t('productAnalytics.body')}
        accessibilityState={{ checked: enabled }}
        testID="settings.productAnalytics"
        className="min-h-[52px] flex-row items-center gap-3 py-2 active:opacity-70"
      >
        <View className="flex-1 gap-0.5">
          <Text variant="body" className="text-[14.5px]">
            {title}
          </Text>
          <Text variant="caption" tone="muted">
            {t('productAnalytics.body')}
          </Text>
        </View>
        <View className={`h-5 w-5 items-center justify-center rounded-[3px] border ${enabled ? 'border-ink bg-ink' : 'border-muted bg-paper'}`}>
          {enabled ? <Icon icon={Check} size={15} tone="cream" /> : null}
        </View>
      </Pressable>
      <ProfileMenuRow icon={FileText} label={t('productAnalytics.privacy')} onPress={openPrivacy} testID="settings.privacyNotice" />
    </RowCard>
  );
}
