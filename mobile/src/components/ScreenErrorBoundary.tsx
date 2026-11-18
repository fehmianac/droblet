import type { ErrorBoundaryProps } from 'expo-router';
import { CircleAlert, RotateCcw } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateMessage } from '@/components/ui/StateMessage';

/**
 * The error state of a route whose render threw (canvas `DurumHata`): headline, one calm sentence and
 * "Tekrar dene" — instead of the whole app closing. Expo Router mounts it for the route file that exports
 * it (`export { ScreenErrorBoundary as ErrorBoundary }`): every tab exports it, so a render error in one
 * tab leaves the tab bar and the other tabs working; the root layout exports it as the last resort.
 */
export function ScreenErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const { t } = useTranslation();
  useEffect(() => {
    // Visible in the device log (ReactNativeJS) for diagnosis; the user sees the calm state below.
    console.error('[ScreenErrorBoundary]', error);
  }, [error]);
  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-cream">
      <View className="flex-1 justify-center" testID="screen-error-boundary">
        <StateMessage
          role="alert"
          icon={CircleAlert}
          title={t('states.crashTitle')}
          message={t('states.crashBody')}
          actionLabel={t('common.retry')}
          actionIcon={RotateCcw}
          actionVariant="primary"
          onAction={() => void retry()}
        />
      </View>
    </SafeAreaView>
  );
}
