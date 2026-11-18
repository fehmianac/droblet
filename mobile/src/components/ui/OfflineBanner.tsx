import { RefreshCw, WifiOff } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useIsOnline, usePendingWrites } from '@/sync/network';

import { Icon } from './Icon';
import { Text } from './Text';

type Props = {
  /**
   * What is being shown from the cache, e.g. "Çevrimdışısın · kayıtlı gardırop gösteriliyor"
   * (`DurumCevrimdisi`). Default: the general sentence.
   */
  message?: string;
};

/**
 * Top band of the offline state (`DurumCevrimdisi`): ink, 36 high, a wifi-off glyph and one centred cream
 * line; the cached list stays visible below it. While online with writes still queued it is the quieter
 * sand "Senkronize ediliyor (N)" line. Announced politely to screen readers.
 */
export function OfflineBanner({ message }: Props = {}) {
  const { t } = useTranslation();
  const online = useIsOnline();
  const pending = usePendingWrites();
  if (online && pending === 0) return null;
  const text = [!online ? (message ?? t('states.offlineBanner')) : null, pending > 0 ? t('states.syncing', { count: pending }) : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <View
      testID="offline-banner"
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      className={`min-h-9 flex-row items-center justify-center gap-2 px-gutter py-2 ${online ? 'bg-sand' : 'bg-ink'}`}
    >
      <Icon icon={online ? RefreshCw : WifiOff} size={16} tone={online ? 'muted' : 'cream'} />
      <Text variant="caption" tone={online ? 'muted' : 'cream'} className="shrink text-center text-[12.5px]">
        {text}
      </Text>
    </View>
  );
}
