import { router, useLocalSearchParams } from 'expo-router';
import { X } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, View, type TextInputInstance } from 'react-native';

import { useLogin, useResetPassword } from '@/api/auth';
import { extractApiError } from '@/api/errors';
import { useSession } from '@/auth/session';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { StateMessage } from '@/components/ui/StateMessage';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { isValidPassword } from '@/lib/validation';

type Errors = { password?: string; repeat?: string };

/**
 * 02d Yeni şifre — opened from the e-mail link: `droplet://reset-password?token=…` or
 * `https://droblet.alatech.co/reset-password?token=…` (optionally `&email=…`). Two fields that must
 * match; close (×) on the right. When the link carries the e-mail the user is signed in right after
 * saving ("Şifreyi kaydet ve giriş yap"); otherwise the saved state leads to the sign-in screen.
 */
export default function ResetPasswordScreen() {
  const { t } = useTranslation();
  const { token, email } = useLocalSearchParams<{ token?: string; email?: string }>();
  const session = useSession();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [linkInvalid, setLinkInvalid] = useState(!token);
  const repeatRef = useRef<TextInputInstance>(null);
  const reset = useResetPassword();
  const login = useLogin();
  const signedIn = session.status === 'signedIn';

  const goLogin = () => router.replace(signedIn ? '/' : { pathname: '/start', params: { mode: 'login' } });
  const requestNew = () => router.replace(signedIn ? '/' : '/forgot-password');

  const submit = () => {
    if (!token) return;
    const next: Errors = {};
    if (!isValidPassword(password)) next.password = t('errors.passwordTooShort');
    else if (repeat !== password) next.repeat = t('reset.mismatch');
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    reset.mutate(
      { token, newPassword: password },
      {
        onSuccess: () => {
          // The navigation guards take a signed-in user to Bugün; a failed sign-in falls back to the saved state.
          if (email && !signedIn) login.mutate({ email, password });
        },
        onError: (e) => {
          const code = extractApiError(e);
          if (code === 'invalid_reset_token') setLinkInvalid(true);
          else setErrors({ password: t(`errors.${code}`) });
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

  const signingIn = reset.isSuccess && Boolean(email) && !signedIn && !login.isError;
  if (reset.isSuccess && !signingIn) {
    return (
      <Screen bottom>
        <View className="flex-1 justify-center gap-2.5 px-6">
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
        <ScreenHeader
          leading="none"
          right={<IconButton icon={X} variant="plain" onPress={goLogin} accessibilityLabel={t('a11y.close')} />}
        />
        <ScrollView className="flex-1" contentContainerClassName="gap-[22px] px-6 pb-6 pt-2" keyboardShouldPersistTaps="handled">
          <View className="gap-2.5">
            <Text variant="eyebrow">{t('reset.eyebrow')}</Text>
            <Text variant="display">{t('reset.title')}</Text>
            <Text variant="body" tone="muted">
              {email ? t('reset.bodyEmail', { email }) : t('reset.body')}
            </Text>
          </View>
          <View className="gap-3.5">
            <TextField
              testID="reset.password"
              label={t('reset.newPassword')}
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                setErrors({});
              }}
              error={errors.password}
              hint={t('auth.passwordHint')}
              password
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="next"
              onSubmitEditing={() => repeatRef.current?.focus()}
            />
            <TextField
              ref={repeatRef}
              testID="reset.repeat"
              label={t('reset.repeatPassword')}
              value={repeat}
              onChangeText={(v) => {
                setRepeat(v);
                setErrors((e) => ({ ...e, repeat: undefined }));
              }}
              error={errors.repeat}
              password
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="done"
              onSubmitEditing={submit}
            />
          </View>
        </ScrollView>
        <View className="px-6 pb-4">
          <Button testID="reset.submit" label={t('reset.submit')} onPress={submit} loading={reset.isPending || signingIn} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
