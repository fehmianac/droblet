import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { useResetPassword } from '@/api/auth';
import { extractApiError } from '@/api/errors';
import { useSession } from '@/auth/session';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { StateMessage } from '@/components/ui/StateMessage';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { isValidPassword } from '@/lib/validation';

/**
 * New password — opened from the e-mail link: `droplet://reset-password?token=…` or
 * `https://droplet.alatech.co/reset-password?token=…`.
 */
export default function ResetPasswordScreen() {
  const { t } = useTranslation();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const session = useSession();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [linkInvalid, setLinkInvalid] = useState(!token);
  const reset = useResetPassword();
  const signedIn = session.status === 'signedIn';

  const goLogin = () => router.replace(signedIn ? '/' : { pathname: '/start', params: { mode: 'login' } });
  const requestNew = () => router.replace(signedIn ? '/' : '/forgot-password');

  const submit = () => {
    if (!token) return;
    if (!isValidPassword(password)) {
      setError(t('errors.passwordTooShort'));
      return;
    }
    reset.mutate(
      { token, newPassword: password },
      {
        onError: (e) => {
          const code = extractApiError(e);
          if (code === 'invalid_reset_token') setLinkInvalid(true);
          else setError(t(`errors.${code}`));
        },
      },
    );
  };

  if (linkInvalid) {
    return (
      <Screen bottom>
        <ScreenHeader title={t('reset.title')} leading="close" onLeadingPress={goLogin} />
        <StateMessage message={t('errors.invalid_reset_token')} actionLabel={t('reset.requestNew')} onAction={requestNew} />
      </Screen>
    );
  }

  if (reset.isSuccess) {
    return (
      <Screen bottom>
        <View className="flex-1 justify-center gap-3 px-gutter">
          <Text variant="display">{t('reset.doneTitle')}</Text>
          <Text variant="body" tone="muted">
            {t('reset.doneBody')}
          </Text>
          <View className="mt-6">
            <Button label={t('reset.login')} onPress={goLogin} />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen bottom>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScreenHeader leading="close" onLeadingPress={goLogin} />
        <ScrollView contentContainerClassName="gap-6 px-gutter pb-8" keyboardShouldPersistTaps="handled">
          <View className="gap-2">
            <Text variant="eyebrow">{t('reset.eyebrow')}</Text>
            <Text variant="display">{t('reset.title')}</Text>
            <Text variant="body" tone="muted">
              {t('reset.body')}
            </Text>
          </View>
          <TextField
            label={t('reset.newPassword')}
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setError(null);
            }}
            error={error}
            hint={t('auth.passwordHint')}
            password
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="done"
            onSubmitEditing={submit}
          />
          <Button label={t('reset.submit')} onPress={submit} loading={reset.isPending} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
