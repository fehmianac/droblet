import { Check } from 'lucide-react-native';
import { Trans, useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { openPrivacy, openTerms } from '@/components/LegalLinks';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';

/**
 * "18 yaşından büyüğüm" — a required, never pre-ticked box with the Terms and Privacy links under it.
 * Used on e-mail sign-up (02) and on the one-time confirmation after Apple / Google (`/age-confirm`).
 */
export function AgeCheckbox({ checked, onToggle, error }: { checked: boolean; onToggle: () => void; error?: string | null }) {
  const { t } = useTranslation();
  return (
    <View className="gap-1.5">
      <Pressable
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityLabel={t('age.label')}
        accessibilityState={{ checked }}
        accessibilityHint={error ?? undefined}
        testID="age.checkbox"
        className="min-h-icon-btn flex-row items-center gap-3 active:opacity-70"
      >
        <View
          className={`h-5 w-5 items-center justify-center rounded-[3px] border ${
            checked ? 'border-ink bg-ink' : error ? 'border-danger bg-paper' : 'border-muted bg-paper'
          }`}
        >
          {checked ? <Icon icon={Check} size={15} tone="cream" /> : null}
        </View>
        <Text variant="body" className="flex-1 text-[14.5px]">
          {t('age.label')}
        </Text>
      </Pressable>
      <Text variant="caption" tone="muted" className="pl-8">
        <Trans
          i18nKey="age.links"
          components={{
            terms: <Text variant="caption" tone="ink" className="underline" accessibilityRole="link" onPress={openTerms} />,
            privacy: <Text variant="caption" tone="ink" className="underline" accessibilityRole="link" onPress={openPrivacy} />,
          }}
        />
      </Text>
      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite" accessibilityRole="alert" className="pl-8">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** "Kullanım Koşulları · Gizlilik Politikası" under the birth year (canvas 18 · 02 / 02f). */
export function LegalLinksLine() {
  return (
    <Text variant="caption" tone="muted" testID="legal.links">
      <Trans
        i18nKey="age.links"
        components={{
          terms: <Text variant="caption" tone="ink" className="underline" accessibilityRole="link" onPress={openTerms} />,
          privacy: <Text variant="caption" tone="ink" className="underline" accessibilityRole="link" onPress={openPrivacy} />,
        }}
      />
    </Text>
  );
}
