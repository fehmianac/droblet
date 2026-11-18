import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Button } from '../Button';
import { Text } from '../Text';

type FailureProps = {
  /** Whether a credit was reserved and returned. Text-only jobs (stilist) pass false. */
  creditRefunded: boolean;
  onRetry: () => void;
  retrying?: boolean;
  /** 'screen' centres in the available space; 'inline' sits inside a card. */
  layout?: 'screen' | 'inline';
};

/**
 * Timeout / failure state of every AI wait: "Şu an oluşturamadık. Kredin iade edildi." + "Tekrar dene".
 * Calm wording, one action; announced to screen readers.
 */
export function AiFailure({ creditRefunded, onRetry, retrying = false, layout = 'screen' }: FailureProps) {
  const { t } = useTranslation();
  return (
    <View
      accessibilityLiveRegion="polite"
      className={layout === 'screen' ? 'flex-1 items-center justify-center gap-5 px-gutter py-12' : 'items-center gap-3 py-4'}
    >
      <Text variant="body" tone="muted" className="text-center">
        {t(creditRefunded ? 'ai.failedRefunded' : 'ai.failed')}
      </Text>
      <Button variant="secondary" label={t('ai.retry')} onPress={onRetry} loading={retrying} />
    </View>
  );
}

type BackgroundProps = {
  onPress: () => void;
  /** Defaults to "Arka planda devam et — bitince haber veririz". */
  label?: string;
};

/**
 * "Arka planda devam et" — leaves the waiting screen while the job keeps running on the server.
 * Outlined, wraps to two lines (the sentence is long), min 52 high.
 */
export function AiBackgroundAction({ onPress, label }: BackgroundProps) {
  const { t } = useTranslation();
  const text = label ?? t('ai.continueInBackground');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={text}
      className="min-h-btn-primary items-center justify-center rounded-[26px] border border-line px-5 py-2.5 active:opacity-80"
    >
      <Text variant="bodyMedium" className="text-center" numberOfLines={3}>
        {text}
      </Text>
    </Pressable>
  );
}
