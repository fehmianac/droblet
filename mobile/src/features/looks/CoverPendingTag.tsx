import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { AiShimmer } from '@/components/ui/ai/AiShimmer';
import { Text } from '@/components/ui/Text';
import { useReduceMotion } from '@/hooks/useReduceMotion';

/**
 * "● Kapak hazırlanıyor" on a lookbook card while its AI flat-lay cover is being made (canvas 21c, 3rd card): paper
 * pill, espresso dot pulsing 0.3 ↔ 1 over 1.2 s (steady with reduce motion). Position it with `className`.
 */
export function CoverPendingTag({ className }: { className?: string }) {
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 1;
      return;
    }
    opacity.value = 0.3;
    opacity.value = withRepeat(withTiming(1, { duration: 600 }), -1, true);
    return () => cancelAnimation(opacity);
  }, [reduceMotion, opacity]);
  const dot = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <View
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      className={`h-6 flex-row items-center gap-1.5 self-start rounded-pill bg-paper/90 px-2.5 ${className ?? ''}`}
      testID="look-cover-pending"
    >
      <Animated.View className="h-1.5 w-1.5 rounded-pill bg-accent" style={dot} />
      <Text variant="caption" tone="ink" numberOfLines={1}>
        {t('looks.coverPending')}
      </Text>
    </View>
  );
}

/**
 * The loading look of a cover that is being made (canvas 21c, 3rd card): a thin paper veil over the drawn flat-lay and
 * the light band of the AI loading language sweeping across it (1.8 s, linear). With reduce motion only the veil stays.
 * Fills the cover; put it under the tags.
 */
export function CoverPendingSweep() {
  return (
    <View style={StyleSheet.absoluteFill} className="bg-paper/25" pointerEvents="none" testID="look-cover-sweep">
      <AiShimmer band={0.6} from={-1.2} to={2.2} />
    </View>
  );
}
