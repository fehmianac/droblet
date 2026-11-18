import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { useForgotPassword } from '@/api/auth';
import { extractApiError } from '@/api/errors';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { isValidEmail } from '@/lib/validation';

/** Şifremi unuttum — e-mail → "sent" (same message whether or not the account exists). */
export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const forgot = useForgotPassword();

  const submit = () => {
    if (!isValidEmail(email)) {
      setError(t('errors.emailInvalid'));
      return;
    }
    forgot.mutate(
      { email: email.trim() },
      { onError: (e) => setError(t(`errors.${extractApiError(e)}`)) },
    );
  };

  if (forgot.isSuccess) {
    return (
      <Screen bottom>
        <ScreenHeader leading="back" />
        <View className="flex-1 gap-3 px-gutter">
          <Text variant="eyebrow">{t('forgot.eyebrow')}</Text>
          <Text variant="display">{t('forgot.sentTitle')}</Text>
          <Text variant="body" tone="muted">
            {t('forgot.sentBody', { email: email.trim() })}
          </Text>
          <View className="mt-6">
            <Button
              label={t('forgot.backToLogin')}
              onPress={() => router.dismissTo({ pathname: '/start', params: { mode: 'login' } })}
            />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen bottom>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScreenHeader leading="back" />
        <ScrollView contentContainerClassName="gap-6 px-gutter pb-8" keyboardShouldPersistTaps="handled">
          <View className="gap-2">
            <Text variant="eyebrow">{t('forgot.eyebrow')}</Text>
            <Text variant="display">{t('forgot.title')}</Text>
            <Text variant="body" tone="muted">
              {t('forgot.body')}
            </Text>
          </View>
          <TextField
            label={t('auth.email')}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setError(null);
            }}
            error={error}
            testID="forgot.email"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="send"
            onSubmitEditing={submit}
          />
          <Button label={t('forgot.submit')} onPress={submit} loading={forgot.isPending} testID="forgot.submit" />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
