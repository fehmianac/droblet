import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View, type TextInputInstance } from 'react-native';

import { KeyboardAvoider } from '@/components/ui/KeyboardAvoider';
import { useAppleSignIn, useGoogleSignIn, useLogin, useRegister } from '@/api/auth';
import { DEFAULT_TEEN_CONFIG } from '@/api/contracts/teen';
import { apiErrorCode, extractApiError, fieldErrors, type KnownErrorCode } from '@/api/errors';
import { useSession } from '@/auth/session';
import { requestAppleCredential } from '@/auth/apple';
import { AppleButton } from '@/components/auth/AppleButton';
import { GoogleSignIn } from '@/components/auth/GoogleSignIn';
import { Button } from '@/components/ui/Button';
import { LegalLinksLine } from '@/features/consent/AgeCheckbox';
import { useAppConfig } from '@/api/appConfig';
import { ageOutcome, bandOf } from '@/features/teen/age';
import { BirthYearField } from '@/features/teen/BirthYearField';
import { TeenIntro, UnderAge } from '@/features/teen/TeenScreens';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { isValidEmail, isValidPassword } from '@/lib/validation';

type Mode = 'register' | 'login';
type Field = 'name' | 'email' | 'password' | 'age' | 'month';
/** Canvas 18: the form, 02h (teen explainer before the account exists) or 02g (under 16 / teen sign-up closed). */
type Step = 'form' | 'intro' | 'underage' | 'closed';
type Errors = Partial<Record<Field | 'form', string>>;

/**
 * 02 Kayıt / giriş — one screen, Kayıt ol / Giriş yap switch (ink segment), no eyebrow, 24 inset. Apple (iOS only), Google, e-mail + password.
 * Field errors sit under the field in danger. Success: register → 03, login → 06 (navigation guards).
 */
export default function AuthStartScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<Mode>(params.mode === 'login' ? 'login' : 'register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  /** Canvas 18 · 02: the birth year (and the month when the year alone cannot tell the band) instead of the 18+ box. */
  const [birthYear, setBirthYear] = useState<number | null>(null);
  const [birthMonth, setBirthMonth] = useState<number | null>(null);
  /** The server asked for the month (`birth_month_required`) although the app did not think it was needed. */
  const [monthAsked, setMonthAsked] = useState(false);
  const [step, setStep] = useState<Step>('form');
  const config = useAppConfig();
  // Config unknown (offline): let the server decide whether teen sign-up is open (`teen_not_available`).
  const teenConfig = config.data?.teen ?? { ...DEFAULT_TEEN_CONFIG, enabled: true };
  const outcome = birthYear ? ageOutcome(birthYear, birthMonth, teenConfig) : null;
  const showMonth = outcome === 'needsMonth' || monthAsked || (birthMonth !== null && birthYear !== null && ageOutcome(birthYear, null, teenConfig) === 'needsMonth');
  const session = useSession();
  // Signed out because the account was suspended (403 `account_suspended` on refresh): say so at once.
  const [errors, setErrors] = useState<Errors>(() =>
    session.status === 'signedOut' && session.reason === 'suspended' ? { form: t('errors.account_suspended') } : {},
  );
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
      const raw = apiErrorCode(error);
      // docs/api/teen.md §3 — nothing is stored for these: the kind screens, or the month.
      if (raw === 'age_under_minimum') return setStep('underage');
      if (raw === 'teen_not_available') return setStep('closed');
      if (raw === 'birth_month_required') {
        setStep('form');
        setMonthAsked(true);
        return setErrors({ month: t('teen.birth.monthRequired') });
      }
      if (raw === 'birth_year_invalid' || raw === 'birth_month_invalid') {
        setStep('form');
        return setErrors({ age: t('teen.birth.invalid') });
      }
      if (step === 'intro') setStep('form');
      if (code === 'email_taken') setErrors({ email: t('errors.email_taken') });
      else if (code === 'invalid_credentials') setErrors({ password: t('errors.invalid_credentials') });
      else if (Object.keys(fields).length > 0) {
        // The server sends validation codes (`name_required`, `email_invalid`, `password_too_short`), never sentences.
        setErrors({
          name: fields.name ? t('errors.nameRequired') : undefined,
          email: fields.email ? t('errors.emailInvalid') : undefined,
          password: fields.password ? t('errors.passwordTooShort') : undefined,
          age: fields.ageConfirmed || fields.birthYear ? t('teen.birth.required') : undefined,
        });
      } else setErrors({ form: t(`errors.${code}`) });
    },
    [t, step],
  );

  const validate = (): Errors => {
    const next: Errors = {};
    if (mode === 'register' && name.trim().length === 0) next.name = t('errors.nameRequired');
    if (!isValidEmail(email)) next.email = t('errors.emailInvalid');
    if (!isValidPassword(password)) next.password = t('errors.passwordTooShort');
    if (mode === 'register' && !birthYear) next.age = t('teen.birth.required');
    else if (mode === 'register' && outcome === 'needsMonth') next.month = t('teen.birth.monthRequired');
    return next;
  };

  const register_ = () => {
    if (!birthYear) return;
    const band = bandOf(outcome ?? 'adult') ?? 'adult';
    register.mutate(
      {
        name: name.trim(),
        email: email.trim(),
        password,
        birthYear,
        ...(birthMonth ? { birthMonth } : {}),
        ...(band === 'adult' ? { ageConfirmed: true as const } : {}),
        ageBand: band,
      },
      { onError: showServerError },
    );
  };

  const submit = () => {
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const trimmedEmail = email.trim();
    if (mode === 'register') {
      // Under 16 never reaches the server: nothing about the child is sent or kept (02g).
      if (outcome === 'underage') return setStep('underage');
      if (outcome === 'teenClosed') return setStep('closed');
      if (outcome === 'teen') return setStep('intro');
      register_();
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

  const { mutate: googleMutate } = google;
  const onGoogleToken = useCallback(
    (idToken: string) => googleMutate({ idToken }, { onError: showServerError }),
    [googleMutate, showServerError],
  );
  const onGoogleError = useCallback(() => setErrors({ form: t('errors.socialFailed') }), [t]);
  const onGoogleUnavailable = useCallback(() => setErrors({ form: t('errors.googleUnavailable') }), [t]);

  const clear = (field: Field) => setErrors((e) => ({ ...e, [field]: undefined, form: undefined }));

  if (step === 'intro') {
    return <TeenIntro onContinue={register_} onFix={() => setStep('form')} loading={register.isPending} error={errors.form} />;
  }
  if (step === 'underage' || step === 'closed') {
    return (
      <UnderAge
        variant={step === 'closed' ? 'closed' : 'email'}
        onPrimary={() => router.replace('/welcome')}
        onFix={() => {
          setStep('form');
          setBirthYear(null);
          setBirthMonth(null);
        }}
      />
    );
  }

  return (
    <Screen bottom>
      <KeyboardAvoider>
        <ScreenHeader leading="back" />
        <ScrollView contentContainerClassName="gap-5 px-6 pb-8 pt-2" keyboardShouldPersistTaps="handled">
          <View className="gap-2.5">
            <Text variant="display">{t(mode === 'register' ? 'auth.titleRegister' : 'auth.titleLogin')}</Text>
            <Text variant="body" tone="muted">
              {t('auth.subtitle')}
            </Text>
          </View>

          <SegmentedControl<Mode>
            variant="ink"
            testID="auth.tab"
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

          <View className="gap-2.5">
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
            <Text variant="eyebrow">{t('auth.or')}</Text>
            <View className="h-px flex-1 bg-line" />
          </View>

          <View className="gap-3">
            {mode === 'register' ? (
              <TextField
                testID="auth.name"
                maxLength={60}
                autoCapitalize="words"
                autoCorrect={false}
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
              testID="auth.email"
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
              // Remounted per tab: switching between Kayıt ol / Giriş yap always starts with the password hidden.
              key={`password-${mode}`}
              ref={passwordRef}
              testID="auth.password"
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
              // 'password' in both modes: with 'newPassword' iOS lays its strong-password assistant over the field and
              // typed characters replace each other (sign-up then stores a password the user never typed).
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={submit}
            />
            {mode === 'login' ? (
              <Pressable
                onPress={() => router.push({ pathname: '/forgot-password', params: { email: email.trim() } })}
                testID="auth.forgot"
                accessibilityRole="link"
                accessibilityLabel={t('auth.forgot')}
                hitSlop={8}
                className="min-h-icon-btn justify-center self-end active:opacity-70"
              >
                <Text variant="label">{t('auth.forgot')}</Text>
              </Pressable>
            ) : null}
            {mode === 'register' ? (
              <>
                <BirthYearField
                  year={birthYear}
                  month={birthMonth}
                  showMonth={showMonth}
                  onYear={(y) => {
                    setBirthYear(y);
                    setBirthMonth(null);
                    setMonthAsked(false);
                    clear('age');
                    clear('month');
                  }}
                  onMonth={(m) => {
                    setBirthMonth(m);
                    clear('month');
                  }}
                  hint={!birthYear ? t('teen.birth.hintEmpty') : outcome === 'teen' ? t('teen.birth.hintTeen') : null}
                  yearError={errors.age}
                  monthError={errors.month}
                />
                <LegalLinksLine />
              </>
            ) : null}
          </View>

          {errors.form ? (
            <Text variant="caption" tone="danger" accessibilityLiveRegion="polite" accessibilityRole="alert">
              {errors.form}
            </Text>
          ) : null}

          <Button testID="auth.submit" label={t(mode === 'register' ? 'auth.submit' : 'auth.submitLogin')} onPress={submit} loading={register.isPending || login.isPending} disabled={busy} />
        </ScrollView>
      </KeyboardAvoider>
    </Screen>
  );
}
