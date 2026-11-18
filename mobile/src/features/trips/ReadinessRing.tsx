import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Text } from '@/components/ui/Text';
import { useThemeColors } from '@/theme/useThemeColors';

import type { Readiness } from './logic';

const SIZE = 56;
const RADIUS = 23;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Hazırlık halkası (19): packed / total as an espresso arc, with the numbers in the middle. */
export function ReadinessRing({ packed, total, ratio }: Readiness) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  return (
    <View
      className="items-center justify-center"
      style={{ width: SIZE, height: SIZE }}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('tripDetail.readinessLabel', { packed, total })}
      accessibilityValue={{ min: 0, max: total, now: packed }}
      testID="readiness-ring"
    >
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ position: 'absolute' }} accessible={false}>
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke={colors.sand} strokeWidth={4} />
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={colors.accent}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={`${CIRCUMFERENCE * ratio} ${CIRCUMFERENCE}`}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </Svg>
      <Text variant="caption" maxFontSizeMultiplier={1.2} accessible={false}>
        {t('tripDetail.readinessValue', { packed, total })}
      </Text>
    </View>
  );
}
