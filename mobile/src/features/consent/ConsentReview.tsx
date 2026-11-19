import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import { ShieldCheck } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CONSENT_TYPES, type ConsentState, type ConsentType } from '@/api/contracts/consents';
import { ApiError } from '@/api/errors';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';

import { useSaveConsents } from './api';
import { ConsentBlock, consentsPageUrl } from './ConsentSheet';

/** Per-user marker: the all-in-one screen was answered (or skipped after a failure) on this device. */
export const consentReviewKey = (userId: string) => `droblet.consentReview.${userId}`;

/** The marker of an answered screen names the consent set it covered: a new consent type asks again. */
export const CONSENT_REVIEW_DONE = `done:${CONSENT_TYPES.join(',')}`;

export async function markConsentReview(userId: string | null, value: 'done' | 'skipped'): Promise<void> {
  if (userId) await AsyncStorage.setItem(consentReviewKey(userId), value === 'done' ? CONSENT_REVIEW_DONE : 'skipped');
}

/** True while some of the seven consents was never answered (record without a version): the screen asks once. */
export function needsConsentReview(state: ConsentState | undefined): boolean {
  if (!state) return false;
  return CONSENT_TYPES.some((type) => {
    const record = state.consents.find((c) => c.type === type);
    return !record || record.version === null;
  });
}

type Props = {
  /** Called once the decisions are recorded (or the user skipped after a failure). */
  onDone: () => void;
  userId: string | null;
  /** 'onboarding' = step 2 of 4 of the sign-up; 'update' = an existing account on the next app open. */
  mode: 'onboarding' | 'update';
  header?: React.ReactNode;
};

/**
 * Owner decision 1 — every explicit consent once, all on one screen, in the canvas consent-sheet style:
 * one card per purpose (title, one-line summary, "Metnin tamamı", its own UNTICKED box with the statement).
 * "Tümünü kabul et" ticks every box and records them; "Seçtiklerimle devam et" records the ticked ones as
 * granted and the others as declined (`PUT v1/tenant/consents`, source `onboarding`, so each decision —
 * also a "no" — is on record and the screen is not shown again). Consents stay specific: never one box for all.
 */
export function ConsentReview({ onDone, userId, mode, header }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const save = useSaveConsents();
  const [checked, setChecked] = useState<ConsentType[]>([]);
  const total = CONSENT_TYPES.length;

  const toggle = (type: ConsentType) => setChecked((prev) => (prev.includes(type) ? prev.filter((x) => x !== type) : [...prev, type]));

  const submit = (granted: readonly ConsentType[]) => {
    if (save.isPending) return;
    save.mutate(
      { decisions: CONSENT_TYPES.map((type) => ({ type, granted: granted.includes(type) })), source: 'onboarding' },
      {
        onSuccess: () => {
          void markConsentReview(userId, 'done');
          onDone();
        },
      },
    );
  };

  const acceptAll = () => {
    setChecked([...CONSENT_TYPES]);
    submit(CONSENT_TYPES);
  };

  const skip = () => {
    void markConsentReview(userId, 'skipped');
    onDone();
  };

  const error = save.isError
    ? t(save.error instanceof ApiError && save.error.code === 'consent_version_outdated' ? 'consent.outdated' : 'consent.failed')
    : null;

  return (
    <View className="flex-1 bg-cream" testID="onboarding.consents">
      {header}
      <ScrollView contentContainerClassName="gap-4 px-6 pb-6 pt-5">
        <View className="h-14 w-14 items-center justify-center rounded-pill bg-sand" accessible={false}>
          <Icon icon={ShieldCheck} size={24} tone="accent" />
        </View>
        <View className="gap-2">
          <Text variant="eyebrow">{t('consent.review.eyebrow')}</Text>
          <Text variant="display" accessibilityRole="header">
            {t(mode === 'update' ? 'consent.review.updatedTitle' : 'consent.review.title')}
          </Text>
          <Text variant="body" tone="muted">
            {t(mode === 'update' ? 'consent.review.updatedLead' : 'consent.review.lead')}
          </Text>
        </View>
        {CONSENT_TYPES.map((type) => (
          <ConsentBlock key={type} type={type} summary checked={checked.includes(type)} onToggle={() => toggle(type)} />
        ))}
        <Text variant="caption" tone="muted">
          {t('consent.review.note')}
        </Text>
        <Button
          variant="text"
          label={t('consent.allTexts')}
          onPress={() => void WebBrowser.openBrowserAsync(consentsPageUrl())}
          className="-ml-2 self-start"
          testID="consents.allTexts"
        />
      </ScrollView>
      <View className="gap-2 border-t border-line bg-cream px-6 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
        <Text variant="caption" tone="muted" className="text-center" accessibilityLiveRegion="polite" testID="consents.selected">
          {t('consent.review.selected', { count: checked.length, total })}
        </Text>
        {error ? (
          <Text variant="caption" tone="danger" accessibilityLiveRegion="polite" accessibilityRole="alert" testID="consents.error">
            {error}
          </Text>
        ) : null}
        <Button label={t('consent.review.acceptAll')} onPress={acceptAll} loading={save.isPending} testID="consents.acceptAll" />
        <Button
          variant="secondary"
          label={t('consent.review.continueSelected')}
          onPress={() => submit(checked)}
          disabled={save.isPending}
          testID="consents.continueSelected"
        />
        {error ? <Button variant="text" label={t('consent.review.skip')} onPress={skip} testID="consents.skip" /> : null}
      </View>
    </View>
  );
}
