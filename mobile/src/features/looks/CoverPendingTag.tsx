import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { LogoLoader } from '@/components/brand/LogoLoader';
import { Text } from '@/components/ui/Text';

/**
 * A lookbook card while its AI flat-lay cover is being made (canvas 21c, 3rd card; owner decision 2026-11-24): a paper
 * veil over the drawn flat-lay, the splash mark drawing itself in a loop at the centre and "Yükleniyor" under it. With
 * reduce motion the mark stands still. Fills the cover; put it under the tags.
 */
export function CoverPendingSplash() {
  const { t } = useTranslation();
  return (
    <View
      style={StyleSheet.absoluteFill}
      className="items-center justify-center gap-2 bg-paper/75"
      pointerEvents="none"
      accessible
      accessibilityRole="text"
      accessibilityLabel={t('looks.coverPendingLabel')}
      accessibilityLiveRegion="polite"
      testID="look-cover-pending"
    >
      <LogoLoader size={40} testID="look-cover-splash" />
      <Text variant="caption" tone="ink" numberOfLines={1}>
        {t('looks.coverPending')}
      </Text>
    </View>
  );
}
