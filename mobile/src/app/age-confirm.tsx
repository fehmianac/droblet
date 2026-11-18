import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { logout } from '@/api/auth';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useConfirmAge } from '@/features/consent/age';
import { AgeCheckbox } from '@/features/consent/AgeCheckbox';

/**
 * 18+ confirmation — once, after the first Apple / Google sign-in (e-mail sign-up has the box on the
 * form). The root guards keep an unconfirmed account here before anything else; "Çıkış yap" is the way out.
 */
export default function AgeConfirmScreen() {
  const { t } = useTranslation();
  const confirm = useConfirmAge();
  const [checked, setChecked] = useState(false);
  const [missing, setMissing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const submit = () => {
    if (!checked) {
      setMissing(true);
      return;
    }
    confirm.mutate();
  };

  return (
    <Screen bottom>
      <ScrollView contentContainerClassName="flex-grow gap-5 px-6 pb-8 pt-10" testID="age-confirm">
        <Logo />
        <View className="gap-2.5">
          <Text variant="display" accessibilityRole="header">
            {t('age.title')}
          </Text>
          <Text variant="body" tone="muted">
            {t('age.body')}
          </Text>
        </View>
        <AgeCheckbox
          checked={checked}
          onToggle={() => {
            setChecked((c) => !c);
            setMissing(false);
          }}
          error={missing ? t('age.required') : null}
        />
        {confirm.isError ? (
          <Text variant="caption" tone="danger" accessibilityLiveRegion="polite" accessibilityRole="alert">
            {t('age.failed')}
          </Text>
        ) : null}
        <View className="flex-1" />
        <View className="gap-2">
          <Button label={t('age.confirm')} onPress={submit} loading={confirm.isPending} testID="age.confirm" />
          <Button
            variant="text"
            label={t('age.signOut')}
            disabled={signingOut}
            onPress={() => {
              setSigningOut(true);
              void logout().finally(() => setSigningOut(false));
            }}
            testID="age.signOut"
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
