import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { logout } from '@/api/auth';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { StateMessage } from '@/components/ui/StateMessage';

/** 28 Profil — not built in this slice; sign-out is available so the auth flow can be exercised. */
export default function ProfileTab() {
  const { t } = useTranslation();
  const [signingOut, setSigningOut] = useState(false);
  return (
    <Screen>
      <ScreenHeader title={t('screens.profile')} leading="none" />
      <StateMessage message={t('states.placeholder')} />
      <View className="gap-2 px-gutter pb-6">
        {__DEV__ ? (
          <Button variant="text" label={t('profile.components')} onPress={() => router.push('/dev/components')} />
        ) : null}
        <Button
          variant="secondary"
          label={t('profile.logout')}
          loading={signingOut}
          onPress={() => {
            setSigningOut(true);
            void logout().finally(() => setSigningOut(false));
          }}
        />
      </View>
    </Screen>
  );
}
