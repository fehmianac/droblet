import type { ErrorBoundaryProps } from 'expo-router';
import { CircleAlert, RotateCcw } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateMessage } from '@/components/ui/StateMessage';

/**
 * The error state of a route whose render threw (canvas `DurumHata`): headline, one calm sentence and
 * "Tekrar dene" — instead of the whole app closing. Expo Router mounts it for the route file that exports
 * it (`export { ScreenErrorBoundary as ErrorBoundary }`): every tab exports it, so a render error in one
 * tab leaves the tab bar and the other tabs working; the root layout exports it as the last resort.
 */
/**
 * Test builds only (extra.showErrorDetail, set while the app is in TestFlight / Play internal testing): one muted line
 * with the error so a tester's screenshot says what broke. Not part of the design; off for the store release.
 */
function errorDetail(error: Error): string | null {
  const extra = Constants.expoConfig?.extra as { showErrorDetail?: boolean } | undefined;
  if (!__DEV__ && !extra?.showErrorDetail) return null;
  const text = `${error?.name ?? 'Error'}: ${error?.message ?? ''}`.replace(/\s+/g, ' ').trim();
  return text.length > 180 ? `${text.slice(0, 180)}…` : text;
}

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
        {errorDetail(error) ? (
          <Text selectable testID="screen-error-detail" className="mt-4 px-6 text-center text-[11px] text-muted">
            {errorDetail(error)}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
