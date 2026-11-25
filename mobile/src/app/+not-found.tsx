import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { StateMessage } from '@/components/ui/StateMessage';

/** Without history (a stale or mistyped link, cold start), back goes to the home tab (Akış). */
const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));

/**
 * A link that matches no screen (an old notification, a mistyped or retired deep link): the `Durum*` not-found state —
 * one sentence and the way back — instead of the router's built-in English page.
 */
export default function NotFoundScreen() {
  const { t } = useTranslation();
  return (
    <Screen>
      <ScreenHeader leading="back" onLeadingPress={leave} />
      <View className="flex-1 justify-center px-gutter">
        <StateMessage testID="route-not-found" role="status" message={t('states.notFound')} actionLabel={t('states.notFoundAction')} onAction={leave} />
      </View>
    </Screen>
  );
}
