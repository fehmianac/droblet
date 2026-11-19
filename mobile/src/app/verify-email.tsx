import { router, useLocalSearchParams } from 'expo-router';
import { MailCheck } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { useSession } from '@/auth/session';
import { Button } from '@/components/ui/Button';
import { CodeInput } from '@/components/ui/CodeInput';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import {
  RESEND_COOLDOWN_SECONDS,
  VERIFY_CODE_LENGTH,
  useResendVerification,
  useVerifyEmail,
  verifyErrorKind,
  type VerifyErrorKind,
} from '@/features/account/emailVerification';
import { useMyProfile } from '@/features/account/queries';

/** Seconds left of the resend countdown (ticks once a second while above zero). */
function useCountdown(): [number, (seconds: number) => void] {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  return [left, setLeft];
}

/**
 * "E-postanı doğrula" — the 6-digit code from the sign-up e-mail (boxes, auto-advance, auto-submit) with "Kodu
 * tekrar gönder" and its 60-second countdown. Also the target of the e-mail link (`droplet://verify-email?token=…`,
 * `https://droblet.alatech.co/verify-email?token=…`): the token is checked at once, signed in or not. Nothing in the
 * app waits for this; the banner and the "Profilini tamamla" item lead here.
 */
export default function VerifyEmailScreen() {
  const { t } = useTranslation();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const session = useSession();
  const signedIn = session.status === 'signedIn';
  const profile = useMyProfile({ enabled: signedIn });
  const verify = useVerifyEmail();
  const resend = useResendVerification();
  const [code, setCode] = useState('');
  const [error, setError] = useState<VerifyErrorKind | null>(null);
  const [left, startCountdown] = useCountdown();
  const [sent, setSent] = useState(false);
  const tokenTried = useRef(false);

  const close = () => (router.canGoBack() ? router.back() : router.replace(signedIn ? '/' : '/start'));
  const done = verify.isSuccess || (signedIn && profile.data?.emailVerified === true && !token);

  useEffect(() => {
    if (!token || tokenTried.current) return;
    tokenTried.current = true;
    verify.mutate({ token }, { onError: (e) => setError(verifyErrorKind(e)) });
  }, [token, verify]);

  const submit = (value: string) => {
    if (value.length !== VERIFY_CODE_LENGTH || verify.isPending) return;
    setError(null);
    verify.mutate(
      { code: value },
      {
        onError: (e) => {
          setError(verifyErrorKind(e));
          setCode('');
        },
      },
    );
  };

  const sendAgain = () => {
    if (left > 0 || resend.isPending) return;
    setError(null);
    resend.mutate(undefined, {
      onSuccess: () => {
        setSent(true);
        setCode('');
        startCountdown(RESEND_COOLDOWN_SECONDS);
      },
      onError: (e) => {
        const kind = verifyErrorKind(e);
        setError(kind);
        // The server's own minute: show the countdown instead of a dead button.
        if (kind === 'tooMany') startCountdown(RESEND_COOLDOWN_SECONDS);
      },
    });
  };

  if (done) {
    return (
      <Screen bottom>
        <ScreenHeader leading="close" onLeadingPress={close} />
        <View className="flex-1 justify-center gap-3 px-6" testID="verify.done" accessibilityLiveRegion="polite">
          <View className="h-14 w-14 items-center justify-center rounded-pill bg-sand">
            <Icon icon={MailCheck} size={26} />
          </View>
          <Text variant="display">{t('verifyEmail.doneTitle')}</Text>
          <Text variant="body" tone="muted">
            {t('verifyEmail.doneBody')}
          </Text>
          <View className="mt-4">
            <Button label={t('verifyEmail.continue')} onPress={close} testID="verify.continue" />
          </View>
        </View>
      </Screen>
    );
  }

  // The link was opened: one check, then either "done" or why not (a new code needs the signed-in app).
  if (token) {
    return (
      <Screen bottom>
        <ScreenHeader leading="close" onLeadingPress={close} />
        <View className="flex-1 justify-center gap-3 px-6" testID="verify.link">
          <Text variant="display">{t(verify.isPending || !error ? 'verifyEmail.checking' : 'verifyEmail.linkFailedTitle')}</Text>
          {error ? (
            <>
              <Text variant="body" tone="muted" accessibilityLiveRegion="polite">
                {t(`verifyEmail.error.${error}`)}
              </Text>
              <View className="mt-4">
                {signedIn ? (
                  <Button label={t('verifyEmail.enterCode')} onPress={() => router.replace('/verify-email')} testID="verify.enterCode" />
                ) : (
                  <Button label={t('verifyEmail.signIn')} onPress={() => router.replace({ pathname: '/start', params: { mode: 'login' } })} />
                )}
              </View>
            </>
          ) : null}
        </View>
      </Screen>
    );
  }

  const email = profile.data?.email ?? null;
  return (
    <Screen bottom>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScreenHeader leading="close" onLeadingPress={close} />
        <ScrollView className="flex-1" contentContainerClassName="gap-6 px-6 pb-6 pt-2" keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
          <View className="gap-2.5">
            <Text variant="eyebrow">{t('verifyEmail.eyebrow')}</Text>
            <Text variant="display" accessibilityRole="header">
              {t('verifyEmail.title')}
            </Text>
            <Text variant="body" tone="muted">
              {email ? t('verifyEmail.body', { email }) : t('verifyEmail.bodyNoEmail')}
            </Text>
          </View>
          <View className="gap-2">
            <CodeInput
              value={code}
              onChangeText={(v) => {
                setCode(v);
                if (error) setError(null);
              }}
              onComplete={submit}
              label={t('verifyEmail.codeLabel')}
              error={error !== null}
              editable={!verify.isPending}
              testID="verify.code"
            />
            {error ? (
              <Text variant="caption" tone="danger" accessibilityLiveRegion="polite" testID="verify.error">
                {t(`verifyEmail.error.${error}`)}
              </Text>
            ) : sent ? (
              <Text variant="caption" tone="muted" accessibilityLiveRegion="polite" testID="verify.sent">
                {t('verifyEmail.sent')}
              </Text>
            ) : null}
          </View>
          <Button
            label={t('verifyEmail.submit')}
            onPress={() => submit(code)}
            disabled={code.length !== VERIFY_CODE_LENGTH}
            loading={verify.isPending}
            testID="verify.submit"
          />
          <Button
            variant="text"
            label={left > 0 ? t('verifyEmail.resendIn', { seconds: left }) : t('verifyEmail.resend')}
            onPress={sendAgain}
            disabled={left > 0}
            loading={resend.isPending}
            testID="verify.resend"
          />
          <Text variant="caption" tone="muted">
            {t('verifyEmail.note')}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
