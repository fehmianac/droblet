import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';

type Props = {
  step: number;
  total: number;
  /** Shows "Atla" next to the step count (04 only). */
  onSkip?: () => void;
  skipTestID?: string;
};

/**
 * Header of the onboarding steps (03, 04, 04b): back button, "1 / 3" on the right (plus "Atla" where the
 * step can be skipped) and the 3 pt progress line underneath, inset 24.
 */
export function StepHeader({ step, total, onSkip, skipTestID }: Props) {
  const { t } = useTranslation();
  const count = t('common.stepOf', { current: step, total });
  return (
    <View>
      <ScreenHeader
        right={
          <View className="flex-row items-center gap-3">
            <Text variant="label">{count}</Text>
            {onSkip ? (
              <Pressable
                onPress={onSkip}
                testID={skipTestID}
                accessibilityRole="button"
                accessibilityLabel={t('common.skip')}
                hitSlop={8}
                className="min-h-icon-btn justify-center active:opacity-70"
              >
                <Text variant="label">{t('common.skip')}</Text>
              </Pressable>
            ) : null}
          </View>
        }
      />
      <View className="px-6">
        <View
          className="h-[3px] overflow-hidden rounded-pill bg-line"
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={count}
          accessibilityValue={{ min: 0, max: total, now: step }}
        >
          <View className="h-full rounded-pill bg-ink" style={{ width: `${Math.round((step / total) * 100)}%` }} />
        </View>
      </View>
    </View>
  );
}
