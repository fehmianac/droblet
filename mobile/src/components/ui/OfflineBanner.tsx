import { CloudOff, RefreshCw } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useIsOnline, usePendingWrites } from '@/sync/network';

import { Icon } from './Icon';
import { Text } from './Text';

/**
 * Top band: offline notice (cached data is shown below it) and/or "Senkronize ediliyor (N)".
 * Announced politely to screen readers.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const online = useIsOnline();
  const pending = usePendingWrites();
  if (online && pending === 0) return null;
  const message = [!online ? t('states.offlineBanner') : null, pending > 0 ? t('states.syncing', { count: pending }) : null]
    .filter(Boolean)
    .join(' ');
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      className="flex-row items-center gap-2 bg-sand px-gutter py-2"
    >
      <Icon icon={online ? RefreshCw : CloudOff} size={16} tone="muted" />
      <Text variant="caption" tone="muted" className="flex-1">
        {message}
      </Text>
    </View>
  );
}
