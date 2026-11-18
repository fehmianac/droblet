import * as WebBrowser from 'expo-web-browser';
import { Check, ShieldCheck } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { linkDomain } from '@/api/config';
import type { ConsentType } from '@/api/contracts/consents';
import { ApiError } from '@/api/errors';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { currentLanguage } from '@/i18n';

import { useSaveConsents } from './api';
import { consentRequests, useConsentRequest, type ConsentRequest } from './store';

/** The consent texts page of the site (`/consents/`, English under `/en/`). */
export function consentsPageUrl(): string {
  return `https://${linkDomain()}${currentLanguage() === 'en' ? '/en' : ''}/consents/`;
}

/** One consent: its title, the statement, the full text on demand and an UNTICKED box that is the consent itself. */
export function ConsentBlock({ type, checked, onToggle }: { type: ConsentType; checked: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const statement = t(`consent.texts.${type}.statement`);
  return (
    <View className="gap-3 rounded-card border border-line bg-paper px-3.5 py-3.5" testID={`consent.block.${type}`}>
      <Text variant="bodyMedium" accessibilityRole="header">
        {t(`consent.texts.${type}.title`)}
      </Text>
      {open ? (
        <View className="gap-2" testID={`consent.text.${type}`}>
          {t(`consent.texts.${type}.body`)
            .split('\n\n')
            .map((paragraph) => (
              <Text key={paragraph} variant="caption" tone="muted" className="leading-[18px]">
                {paragraph}
              </Text>
            ))}
        </View>
      ) : null}
      <Button
        variant="text"
        label={t(open ? 'consent.readLess' : 'consent.readMore')}
        onPress={() => setOpen((o) => !o)}
        className="-ml-2 self-start"
        testID={`consent.more.${type}`}
      />
      <Pressable
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityLabel={statement}
        accessibilityState={{ checked }}
        testID={`consent.check.${type}`}
        className="flex-row items-start gap-3 border-t border-line pt-3 active:opacity-70"
      >
        <View className={`mt-0.5 h-5 w-5 items-center justify-center rounded-[3px] border ${checked ? 'border-ink bg-ink' : 'border-muted bg-paper'}`}>
          {checked ? <Icon icon={Check} size={15} tone="cream" /> : null}
        </View>
        <View className="flex-1 gap-1">
          <Text variant="eyebrow">{t('consent.statementLabel')}</Text>
          <Text variant="body" className="text-[14.5px] leading-5">
            {statement}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

function SheetBody({ request }: { request: ConsentRequest }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const save = useSaveConsents();
  const [checked, setChecked] = useState<ConsentType[]>([]);
  const all = request.types.every((type) => checked.includes(type));

  const toggle = (type: ConsentType) => setChecked((prev) => (prev.includes(type) ? prev.filter((x) => x !== type) : [...prev, type]));
  const agree = () => {
    if (!all) return;
    save.mutate(
      { decisions: request.types.map((type) => ({ type, granted: true })), source: request.source },
      { onSuccess: () => consentRequests.settle(true) },
    );
  };
  const error = save.isError
    ? t(save.error instanceof ApiError && save.error.code === 'consent_version_outdated' ? 'consent.outdated' : 'consent.failed')
    : null;

  return (
    <View className="flex-1 bg-cream" testID="consent-sheet" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
      <ScrollView contentContainerClassName="gap-4 px-gutter pb-6 pt-6">
        <View className="h-14 w-14 items-center justify-center rounded-pill bg-sand" accessible={false}>
          <Icon icon={ShieldCheck} size={24} tone="accent" />
        </View>
        <Text variant="h2" accessibilityRole="header">
          {t('consent.sheetTitle')}
        </Text>
        <Text variant="body" tone="muted">
          {request.types.length > 1 ? t('consent.leadMany', { count: request.types.length }) : t('consent.lead')}
        </Text>
        {request.types.map((type) => (
          <ConsentBlock key={type} type={type} checked={checked.includes(type)} onToggle={() => toggle(type)} />
        ))}
        <Button
          variant="text"
          label={t('consent.allTexts')}
          onPress={() => void WebBrowser.openBrowserAsync(consentsPageUrl())}
          className="-ml-2 self-start"
          testID="consent.allTexts"
        />
      </ScrollView>
      <View className="gap-2 px-gutter pt-2">
        {error ? (
          <Text variant="caption" tone="danger" accessibilityLiveRegion="polite" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button label={t('consent.agree')} onPress={agree} disabled={!all} loading={save.isPending} testID="consent.agree" />
        <Button variant="secondary" label={t('consent.notNow')} onPress={() => consentRequests.settle(false)} testID="consent.notNow" />
      </View>
    </View>
  );
}

/**
 * Açık rıza — the just-in-time sheet (Consent texts 1–6, verbatim from the site's `/consents` page).
 * Each consent is its own unticked box; "Onaylıyorum" is enabled only when every box the feature needs
 * is ticked, and records them (`PUT v1/tenant/consents`, with the text version). "Şimdi değil" leaves
 * the feature off and everything else working. Opened through `consentRequests` / `ensureConsents`.
 */
export function ConsentHost() {
  const request = useConsentRequest();
  const reduceMotion = useReduceMotion();
  return (
    <Modal
      visible={request !== null}
      animationType={reduceMotion ? 'none' : 'slide'}
      presentationStyle="pageSheet"
      onRequestClose={() => consentRequests.settle(false)}
    >
      {/* Keyed by the request: a new request starts with every box unticked. */}
      {request ? <SheetBody key={`${request.source}:${request.types.join(',')}`} request={request} /> : null}
    </Modal>
  );
}
