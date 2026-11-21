import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { logout } from '@/api/auth';
import { DEFAULT_TEEN_CONFIG } from '@/api/contracts/teen';
import { apiErrorCode } from '@/api/errors';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { LegalLinksLine } from '@/features/consent/AgeCheckbox';
import { useAppConfig } from '@/api/appConfig';
import { ageOutcome } from '@/features/teen/age';
import { useConfirmBirthYear } from '@/features/teen/api';
import { BirthYearField } from '@/features/teen/BirthYearField';
import { TeenIntro, UnderAge } from '@/features/teen/TeenScreens';

type Step = 'form' | 'intro' | 'underage' | 'closed';

/**
 * 02f Doğum yılı — once, after the first Apple / Google sign-in (e-mail sign-up asks on the form). The root guards keep
 * an account without an age here before anything else; "Çıkış yap" is the way out. A 16–17 year old sees 02h before
 * the year is sent (the band cannot change afterwards); under 16 the server deletes the account and 02g signs out.
 */
export default function AgeConfirmScreen() {
  const { t } = useTranslation();
  const confirm = useConfirmBirthYear();
  const config = useAppConfig();
  const teenConfig = config.data?.teen ?? { ...DEFAULT_TEEN_CONFIG, enabled: true };
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [monthAsked, setMonthAsked] = useState(false);
  const [yearError, setYearError] = useState<string | null>(null);
  const [monthError, setMonthError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [step, setStep] = useState<Step>('form');
  const [signingOut, setSigningOut] = useState(false);

  const outcome = year ? ageOutcome(year, month, teenConfig) : null;
  const showMonth =
    outcome === 'needsMonth' || monthAsked || (month !== null && year !== null && ageOutcome(year, null, teenConfig) === 'needsMonth');

  const signOut = () => {
    setSigningOut(true);
    void logout().finally(() => setSigningOut(false));
  };

  const send = () => {
    if (!year) return;
    setFailed(false);
    confirm.mutate(
      { birthYear: year, birthMonth: month },
      {
        onError: (error) => {
          const code = apiErrorCode(error);
          if (code === 'age_under_minimum') return setStep('underage');
          if (code === 'teen_not_available') return setStep('closed');
          setStep('form');
          if (code === 'birth_month_required') {
            setMonthAsked(true);
            return setMonthError(t('teen.birth.monthRequired'));
          }
          if (code === 'birth_year_invalid' || code === 'birth_month_invalid') return setYearError(t('teen.birth.invalid'));
          setFailed(true);
        },
      },
    );
  };

  const submit = () => {
    if (!year) return setYearError(t('teen.birth.required'));
    if (outcome === 'needsMonth') return setMonthError(t('teen.birth.monthRequired'));
    if (outcome === 'teen') return setStep('intro');
    // Adults, and under 16 too: the server needs the year to close the account the provider sign-in created.
    send();
  };

  if (step === 'intro') {
    return <TeenIntro onContinue={send} onFix={() => setStep('form')} loading={confirm.isPending} error={failed ? t('teen.confirm.failed') : null} />;
  }
  if (step === 'underage' || step === 'closed') {
    return <UnderAge variant={step === 'closed' ? 'closed' : 'social'} onPrimary={signOut} busy={signingOut} />;
  }

  return (
    <Screen bottom>
      <ScrollView contentContainerClassName="flex-grow gap-6 px-6 pb-10 pt-10" testID="age-confirm">
        <View className="gap-2.5">
          <Text variant="eyebrow">{t('teen.confirm.eyebrow')}</Text>
          <Text variant="display" accessibilityRole="header">
            {t('teen.confirm.title')}
          </Text>
          <Text variant="body" tone="muted">
            {t('teen.confirm.body')}
          </Text>
        </View>
        <View className="gap-2">
          <BirthYearField
            year={year}
            month={month}
            showMonth={showMonth}
            onYear={(y) => {
              setYear(y);
              setMonth(null);
              setMonthAsked(false);
              setYearError(null);
              setMonthError(null);
            }}
            onMonth={(m) => {
              setMonth(m);
              setMonthError(null);
            }}
            hint={outcome === 'teen' ? t('teen.birth.hintTeen') : null}
            yearError={yearError}
            monthError={monthError}
          />
          <LegalLinksLine />
        </View>
        {failed ? (
          <Text variant="caption" tone="danger" accessibilityLiveRegion="polite" accessibilityRole="alert">
            {t('teen.confirm.failed')}
          </Text>
        ) : null}
        <View className="flex-1" />
        <View className="gap-1.5">
          <Button label={t('teen.confirm.continue')} onPress={submit} loading={confirm.isPending} testID="age.confirm" />
          <Button variant="text" label={t('teen.confirm.signOut')} disabled={signingOut} onPress={signOut} testID="age.signOut" />
        </View>
      </ScrollView>
    </Screen>
  );
}
