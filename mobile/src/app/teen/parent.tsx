import { router, useCanGoBack, useLocalSearchParams } from 'expo-router';
import { Check, Lock } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { ApiError } from '@/api/errors';
import { useSession } from '@/auth/session';
import { Card } from '@/components/blocks/basics';
import { InfoNote } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { KeyboardAvoider } from '@/components/ui/KeyboardAvoider';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useRequestParentalConsent, useResendParentalConsent } from '@/features/teen/api';
import { useTeenRules, useTeenSnapshot } from '@/features/teen/store';
import { EyebrowHeader } from '@/features/teen/TeenScreens';
import { isValidEmail } from '@/lib/validation';

/** Seconds until `iso` (0 when passed or unknown). */
function secondsUntil(iso: string | null, now: number): number {
  if (!iso) return 0;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now) / 1000)) : 0;
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Server answer of a parent e-mail request → the line under the field. */
function sendError(error: unknown): 'invalid' | 'same' | 'rateLimited' | 'failed' {
  if (error instanceof ApiError) {
    if (error.code === 'parent_email_invalid') return 'invalid';
    if (error.code === 'parent_email_same_as_teen') return 'same';
    if (error.status === 429) return 'rateLimited';
  }
  return 'failed';
}

function Line({ text, locked }: { text: string; locked?: boolean }) {
  return (
    <View className="min-h-[28px] flex-row items-center gap-2.5">
      <Icon icon={locked ? Lock : Check} size={16} tone={locked ? 'muted' : 'ink'} />
      <Text variant="body" tone={locked ? 'muted' : 'ink'} className="flex-1 text-[13.5px]">
        {text}
      </Text>
    </View>
  );
}

/**
 * 02i Velinin e-postası / 02j Velinin onayı bekleniyor (canvas 18). A teen who never sent the e-mail lands here before
 * the app (route guard); later the Bugün band, Profil › Veli onayı and the locked states open it. Entry: nothing sent,
 * declined, withdrawn, or "E-postayı değiştir". Waiting: a request is open (or its 7-day link expired).
 */
export default function ParentConsentScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ edit?: string }>();
  const canGoBack = useCanGoBack();
  const session = useSession();
  const rules = useTeenRules();
  const { state } = useTeenSnapshot();
  const teen = state?.teen ?? null;
  const request = useRequestParentalConsent();
  const resend = useResendParentalConsent();

  const [editing, setEditing] = useState(params.edit === '1');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [resent, setResent] = useState(false);

  const waiting = rules.consent === 'pending' && !editing;
  const left = secondsUntil(teen?.resendAvailableAt ?? null, now);

  useEffect(() => {
    if (!waiting || left <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waiting, left]);

  useEffect(() => {
    if (!resent) return;
    const id = setTimeout(() => setResent(false), 3000);
    return () => clearTimeout(id);
  }, [resent]);

  /** "Uygulamaya devam et" / ✕: back where the teen came from, or into the app (the guards pick onboarding or Bugün). */
  const leave = () => {
    if (canGoBack) router.back();
    else router.replace('/');
  };

  const send = () => {
    const value = email.trim();
    if (!isValidEmail(value)) {
      setError(t('teen.parent.invalid'));
      return;
    }
    const own = session.status === 'signedIn' ? session.user.email.trim().toLowerCase() : '';
    if (own && own === value.toLowerCase()) {
      setError(t('teen.parent.same'));
      return;
    }
    setError(null);
    request.mutate(value, {
      onSuccess: () => {
        setEditing(false);
        setNow(Date.now());
      },
      onError: (e) => setError(t(`teen.parent.${sendError(e)}`)),
    });
  };

  if (!waiting) {
    return (
      <Screen bottom>
        <KeyboardAvoider>
          {canGoBack ? (
            <EyebrowHeader
              eyebrow={t('teen.parent.eyebrow')}
              onBack={() => (editing && rules.consent === 'pending' && params.edit !== '1' ? setEditing(false) : router.back())}
            />
          ) : (
            <View className="h-12 items-center justify-center">
              <Text variant="eyebrow">{t('teen.parent.eyebrow')}</Text>
            </View>
          )}
          <ScrollView contentContainerClassName="flex-grow gap-[22px] px-6 pb-10 pt-4" keyboardShouldPersistTaps="handled" testID="teen.parent">
            <View className="gap-2.5">
              <Text variant="display" accessibilityRole="header">
                {t('teen.parent.title')}
              </Text>
              <Text variant="body" tone="muted">
                {t('teen.parent.body')}
              </Text>
            </View>
            <TextField
              testID="teen.parent.email"
              label={t('teen.parent.label')}
              placeholder={t('teen.parent.placeholder')}
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
              onSubmitEditing={send}
            />
            <InfoNote icon={Lock} text={t('teen.parent.info')} />
            <View className="flex-1" />
            <Button label={t('teen.parent.send')} onPress={send} loading={request.isPending} testID="teen.parent.send" />
          </ScrollView>
        </KeyboardAvoider>
      </Screen>
    );
  }

  const masked = teen?.parentEmailMasked ?? t('teen.waiting.parentFallback');
  const expired = teen?.requestState === 'expired';
  const resendLabel = resent
    ? t('teen.waiting.resent')
    : left > 0 && !expired
      ? t('teen.waiting.resendIn', { time: clock(left) })
      : t('teen.waiting.resend');
  const resendReady = !resent && (left <= 0 || expired);

  return (
    <Screen bottom>
      <EyebrowHeader eyebrow={t('teen.parent.eyebrow')} onBack={leave} close />
      <ScrollView contentContainerClassName="flex-grow gap-[18px] px-6 pb-8 pt-3" testID="teen.waiting">
        <View className="gap-2.5">
          <Text variant="display" accessibilityRole="header">
            {t('teen.waiting.title')}
          </Text>
          <Text variant="body" tone="muted" testID={expired ? 'teen.waiting.expired' : 'teen.waiting.body'}>
            {t(expired ? 'teen.waiting.expired' : 'teen.waiting.body', { email: masked })}
          </Text>
        </View>
        <Card className="gap-1.5 px-4 py-3.5">
          <Text variant="eyebrow">{t('teen.waiting.openNow')}</Text>
          <Line text={t('teen.waiting.open1')} />
          <Line text={t('teen.waiting.open2')} />
          <Line text={t('teen.waiting.open3')} />
          <Text variant="eyebrow" className="mt-2">
            {t('teen.waiting.lockedLater')}
          </Text>
          <Line locked text={t('teen.waiting.locked1')} />
          <Line locked text={t('teen.waiting.locked2')} />
          <Line locked text={t('teen.waiting.locked3')} />
        </Card>
        <View className="flex-1" />
        <View className="gap-1">
          <Button label={t('teen.waiting.continue')} onPress={leave} testID="teen.waiting.continue" />
          <Button
            variant="text"
            label={resendLabel}
            disabled={!resendReady}
            loading={resend.isPending}
            onPress={() =>
              resend.mutate(undefined, {
                onSuccess: () => {
                  setResent(true);
                  setNow(Date.now());
                },
              })
            }
            testID="teen.waiting.resend"
          />
          <Button variant="text" label={t('teen.waiting.change')} onPress={() => setEditing(true)} testID="teen.waiting.change" />
        </View>
      </ScrollView>
    </Screen>
  );
}
