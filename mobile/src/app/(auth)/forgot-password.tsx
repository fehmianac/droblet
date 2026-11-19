import { router, useLocalSearchParams } from 'expo-router';
import { Mail } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Linking, Platform, ScrollView, View } from 'react-native';

import { KeyboardAvoider } from '@/components/ui/KeyboardAvoider';
import { useForgotPassword } from '@/api/auth';
import { extractApiError } from '@/api/errors';
import { InfoNote } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { isValidEmail } from '@/lib/validation';

/** Seconds before "Tekrar gönder" is available again (02c shows the countdown). */
const RESEND_SECONDS = 60;

/** 42 → "0:42" — a countdown, not a localised number. */
function countdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Opens the mail inbox where the platform has a way to; otherwise the default mail handler. */
async function openMailApp(): Promise<void> {
  try {
    await Linking.openURL(Platform.OS === 'ios' ? 'message://' : 'mailto:');
  } catch {
    await Linking.openURL('mailto:').catch(() => undefined);
  }
}

/**
 * 02b Şifremi unuttum → 02c Bağlantı gönderildi (one route, two states). The confirmation is the same
 * whether or not the address has an account. "Tekrar gönder" unlocks after the countdown.
 */
export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const forgot = useForgotPassword();

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  const send = (address: string) =>
    forgot.mutate(
      { email: address },
      {
        onSuccess: () => {
          setError(null);
          setSentTo(address);
          setSecondsLeft(RESEND_SECONDS);
        },
        onError: (e) => setError(t(`errors.${extractApiError(e)}`)),
      },
    );

  const submit = () => {
    if (!isValidEmail(email)) {
      setError(t('errors.emailInvalid'));
      return;
    }
    send(email.trim());
  };

  const backToLogin = () => router.dismissTo({ pathname: '/start', params: { mode: 'login' } });

  if (sentTo) {
    const waiting = secondsLeft > 0;
    return (
      <Screen bottom>
        <ScreenHeader leading="back" onLeadingPress={() => setSentTo(null)} />
        <ScrollView className="flex-1" contentContainerClassName="items-start gap-[22px] px-6 pt-[60px]">
          <View className="h-[72px] w-[72px] items-center justify-center rounded-pill bg-sand">
            <Icon icon={Mail} size={30} />
          </View>
          <View className="gap-2.5">
            <Text variant="display">{t('forgot.sentTitle')}</Text>
            <Text variant="body" tone="muted">
              <Trans
                i18nKey="forgot.sentBody"
                values={{ email: sentTo }}
                components={{ strong: <Text variant="bodyMedium" /> }}
              />
            </Text>
          </View>
          <Text variant="caption" tone="muted">
            {t('forgot.sentHint')}
          </Text>
          {error ? (
            <Text variant="caption" tone="danger" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
        </ScrollView>
        <View className="gap-1.5 px-6 pb-4">
          <Button label={t('forgot.openMail')} onPress={() => void openMailApp()} />
          <Button
            variant="text"
            label={waiting ? t('forgot.resendIn', { time: countdown(secondsLeft) }) : t('forgot.resend')}
            accessibilityHint={waiting ? t('forgot.resendInA11y', { seconds: secondsLeft }) : undefined}
            onPress={() => send(sentTo)}
            disabled={waiting}
            loading={forgot.isPending}
            testID="forgot-resend"
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen bottom>
      <KeyboardAvoider>
        <ScreenHeader leading="back" />
        <ScrollView className="flex-1" contentContainerClassName="gap-6 px-6 pb-6 pt-2" keyboardShouldPersistTaps="handled">
          <View className="gap-2.5">
            <Text variant="eyebrow">{t('forgot.eyebrow')}</Text>
            <Text variant="display">{t('forgot.title')}</Text>
            <Text variant="body" tone="muted">
              {t('forgot.body')}
            </Text>
          </View>
          <TextField
            testID="forgot.email"
            label={t('auth.email')}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setError(null);
            }}
            error={error}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="send"
            onSubmitEditing={submit}
          />
          <InfoNote text={t('forgot.note')} />
        </ScrollView>
        <View className="gap-1.5 px-6 pb-4">
          <Button testID="forgot.submit" label={t('forgot.submit')} onPress={submit} loading={forgot.isPending} />
          <Button variant="text" label={t('forgot.backToLogin')} onPress={backToLogin} />
        </View>
      </KeyboardAvoider>
    </Screen>
  );
}
