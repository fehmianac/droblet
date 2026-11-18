import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, View, type TextInputInstance } from 'react-native';

import { useAppleSignIn, useGoogleSignIn, useLogin, useRegister } from '@/api/auth';
import { extractApiError, fieldErrors, type KnownErrorCode } from '@/api/errors';
import { requestAppleCredential } from '@/auth/apple';
import { AppleButton } from '@/components/auth/AppleButton';
import { GoogleSignIn } from '@/components/auth/GoogleSignIn';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { isValidEmail, isValidPassword } from '@/lib/validation';

type Mode = 'register' | 'login';
type Field = 'name' | 'email' | 'password';
type Errors = Partial<Record<Field | 'form', string>>;

/**
 * 02 Kayıt / giriş — one screen, Kayıt ol / Giriş yap tabs. Apple (iOS only), Google, e-mail + password.
 * Field errors sit under the field in danger. Success: register → 03, login → 06 (navigation guards).
 */
export default function AuthStartScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<Mode>(params.mode === 'login' ? 'login' : 'register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const emailRef = useRef<TextInputInstance>(null);
  const passwordRef = useRef<TextInputInstance>(null);

  const register = useRegister();
  const login = useLogin();
  const apple = useAppleSignIn();
  const google = useGoogleSignIn();
  const busy = register.isPending || login.isPending || apple.isPending || google.isPending;

  const showServerError = useCallback(
    (error: unknown) => {
      const code: KnownErrorCode = extractApiError(error);
      const fields = fieldErrors(error);
      if (code === 'email_taken') setErrors({ email: t('errors.email_taken') });
      else if (code === 'invalid_credentials') setErrors({ password: t('errors.invalid_credentials') });
      else if (Object.keys(fields).length > 0) {
        setErrors({ name: fields.name, email: fields.email, password: fields.password });
      } else setErrors({ form: t(`errors.${code}`) });
    },
    [t],
  );

  const validate = (): Errors => {
    const next: Errors = {};
    if (mode === 'register' && name.trim().length === 0) next.name = t('errors.nameRequired');
    if (!isValidEmail(email)) next.email = t('errors.emailInvalid');
    if (!isValidPassword(password)) next.password = t('errors.passwordTooShort');
    return next;
  };

  const submit = () => {
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const trimmedEmail = email.trim();
    if (mode === 'register') {
      register.mutate({ name: name.trim(), email: trimmedEmail, password }, { onError: showServerError });
    } else {
      login.mutate({ email: trimmedEmail, password }, { onError: showServerError });
    }
  };

  const onApple = async () => {
    setErrors({});
    try {
      const credential = await requestAppleCredential();
      if (credential) apple.mutate(credential, { onError: showServerError });
    } catch {
      setErrors({ form: t('errors.socialFailed') });
    }
  };

  const onGoogleToken = useCallback(
    (idToken: string) => google.mutate({ idToken }, { onError: showServerError }),
    [google, showServerError],
  );
  const onGoogleError = useCallback(() => setErrors({ form: t('errors.socialFailed') }), [t]);
  const onGoogleUnavailable = useCallback(() => setErrors({ form: t('errors.googleUnavailable') }), [t]);

  const clear = (field: Field) => setErrors((e) => ({ ...e, [field]: undefined, form: undefined }));

  return (
    <Screen bottom>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScreenHeader leading="back" />
        <ScrollView contentContainerClassName="gap-6 px-gutter pb-8" keyboardShouldPersistTaps="handled">
          <View className="gap-2">
            <Text variant="eyebrow">{t(mode === 'register' ? 'auth.eyebrowRegister' : 'auth.eyebrowLogin')}</Text>
            <Text variant="display">{t(mode === 'register' ? 'auth.titleRegister' : 'auth.titleLogin')}</Text>
            <Text variant="body" tone="muted">
              {t('auth.subtitle')}
            </Text>
          </View>

          <SegmentedControl<Mode>
            value={mode}
            onChange={(m) => {
              setMode(m);
              setErrors({});
            }}
            segments={[
              { value: 'register', label: t('auth.tabRegister') },
              { value: 'login', label: t('auth.tabLogin') },
            ]}
          />

          <View className="gap-3">
            <AppleButton mode={mode} onPress={() => void onApple()} disabled={busy} />
            <GoogleSignIn
              onIdToken={onGoogleToken}
              onError={onGoogleError}
              onUnavailable={onGoogleUnavailable}
              loading={google.isPending}
              disabled={busy}
            />
          </View>

          <View className="flex-row items-center gap-3" accessible={false}>
            <View className="h-px flex-1 bg-line" />
            <Text variant="caption" tone="muted">
              {t('auth.or')}
            </Text>
            <View className="h-px flex-1 bg-line" />
          </View>

          <View className="gap-4">
            {mode === 'register' ? (
              <TextField
                label={t('auth.name')}
                value={name}
                onChangeText={(v) => {
                  setName(v);
                  clear('name');
                }}
                error={errors.name}
                autoComplete="name"
                textContentType="name"
                returnKeyType="next"
                onSubmitEditing={() => emailRef.current?.focus()}
              />
            ) : null}
            <TextField
              ref={emailRef}
              label={t('auth.email')}
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                clear('email');
              }}
              error={errors.email}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
            <TextField
              ref={passwordRef}
              label={t('auth.password')}
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                clear('password');
              }}
              error={errors.password}
              hint={mode === 'register' ? t('auth.passwordHint') : undefined}
              password
              autoCapitalize="none"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              textContentType={mode === 'register' ? 'newPassword' : 'password'}
              returnKeyType="go"
              onSubmitEditing={submit}
            />
            {mode === 'login' ? (
              <View className="items-start">
                <Button
                  variant="text"
                  label={t('auth.forgot')}
                  onPress={() => router.push({ pathname: '/forgot-password', params: { email: email.trim() } })}
                  className="-ml-2"
                />
              </View>
            ) : null}
          </View>

          {errors.form ? (
            <Text variant="caption" tone="danger" accessibilityLiveRegion="polite" accessibilityRole="alert">
              {errors.form}
            </Text>
          ) : null}

          <Button label={t('auth.submit')} onPress={submit} loading={register.isPending || login.isPending} disabled={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
