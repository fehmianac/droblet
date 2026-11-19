import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import type { ConsentType } from '@/api/contracts/consents';
import { ApiError } from '@/api/errors';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useSaveConsents } from '@/features/consent/api';
import { ConsentBlock, consentsPageUrl } from '@/features/consent/ConsentSheet';

import { StepBar, type StepProps } from './StepBar';

/**
 * Canvas 11c "Açık rıza" step — the fallback for a consent declined on the all-in-one screen: one card and one
 * unticked box per consent; "Onayla ve devam et" only when every box is ticked.
 */
export function StepConsent({ types, onDone }: StepProps & { types: ConsentType[] }) {
  const { t } = useTranslation();
  const save = useSaveConsents();
  const [checked, setChecked] = useState<ConsentType[]>([]);
  const left = types.filter((type) => !checked.includes(type)).length;
  const toggle = (type: ConsentType) => setChecked((prev) => (prev.includes(type) ? prev.filter((x) => x !== type) : [...prev, type]));
  const confirm = () => {
    if (left > 0) return;
    save.mutate({ decisions: types.map((type) => ({ type, granted: true })), source: 'requirements' }, { onSuccess: onDone });
  };
  const status = left === 0 ? t('req.consent.ready') : left === types.length && types.length > 1 ? t('req.consent.leftAll') : t('req.consent.left', { count: left });
  const error = save.isError
    ? t(save.error instanceof ApiError && save.error.code === 'consent_version_outdated' ? 'consent.outdated' : 'consent.failed')
    : null;

  return (
    <View className="flex-1" testID="requirements.step.consent">
      <ScrollView contentContainerClassName="gap-4 px-6 pb-6 pt-5">
        <View className="gap-2">
          <Text variant="display" className="text-[32px] leading-[36px]" accessibilityRole="header">
            {t('req.consent.title')}
          </Text>
          <Text variant="body" tone="muted">
            {t('req.consent.lead', { count: types.length })}
          </Text>
        </View>
        {types.map((type) => (
          <ConsentBlock key={type} type={type} summary checked={checked.includes(type)} onToggle={() => toggle(type)} />
        ))}
        <Button
          variant="text"
          label={t('consent.allTexts')}
          onPress={() => void WebBrowser.openBrowserAsync(consentsPageUrl())}
          className="-ml-2 self-start"
          testID="requirements.consent.allTexts"
        />
      </ScrollView>
      <StepBar>
        {error ? (
          <Text variant="caption" tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button label={t('req.consent.confirm')} onPress={confirm} disabled={left > 0} loading={save.isPending} testID="requirements.consent.confirm" />
        <Text variant="caption" tone="muted" className="text-center text-[11.5px]" accessibilityLiveRegion="polite">
          {status}
        </Text>
      </StepBar>
    </View>
  );
}
