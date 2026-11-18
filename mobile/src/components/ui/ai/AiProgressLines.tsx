import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';

import { useReduceMotion } from '@/hooks/useReduceMotion';
import { motion } from '@/theme/tokens';

import { Text } from '../Text';

const FADE_MS = 320;

type Props = {
  /** Calm, human progress sentences ("Parçalar hazırlanıyor…"). Shown one at a time. */
  lines: string[];
  /** 'title' = h3 (full-screen waits), 'compact' = 13 pt medium (inside a card). */
  size?: 'title' | 'compact';
  align?: 'left' | 'center';
  intervalMs?: number;
};

/**
 * Rotating progress text: one line every 2 s, cross-fading with a 4 pt rise, looping. It is the
 * screen-reader status of an AI wait (polite live region). With reduce-motion the first line stays.
 */
export function AiProgressLines({ lines, size = 'title', align = 'left', intervalMs = motion.lineIntervalMs }: Props) {
  const reduceMotion = useReduceMotion();
  const [index, setIndex] = useState(0);
  // 0 = entering from below, 1 = shown, 2 = left upwards.
  const v = useSharedValue(1);
  const rotating = !reduceMotion && lines.length > 1;

  useEffect(() => {
    if (!rotating) return;
    const timer = setInterval(() => setIndex((i) => i + 1), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, rotating]);

  useEffect(() => {
    if (!rotating) {
      cancelAnimation(v);
      v.set(1);
      return;
    }
    v.set(0);
    v.set(
      withSequence(
        withTiming(1, { duration: FADE_MS, easing: Easing.inOut(Easing.ease) }),
        withDelay(Math.max(0, intervalMs - FADE_MS * 2), withTiming(2, { duration: FADE_MS, easing: Easing.inOut(Easing.ease) })),
      ),
    );
    return () => cancelAnimation(v);
  }, [index, intervalMs, rotating, v]);

  const style = useAnimatedStyle(() => ({
    opacity: v.value <= 1 ? v.value : 2 - v.value,
    transform: [{ translateY: (1 - v.value) * 4 }],
  }));

  const line = lines[rotating ? index % lines.length : 0] ?? '';
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel={line}
      className={size === 'title' ? 'min-h-[30px] justify-center' : 'min-h-5 justify-center'}
    >
      <Animated.View style={style}>
        <Text
          variant={size === 'title' ? 'h3' : 'bodyMedium'}
          accessibilityRole="none"
          numberOfLines={2}
          className={`${size === 'compact' ? 'text-[13px] leading-[18px]' : ''} ${align === 'center' ? 'text-center' : ''}`}
        >
          {line}
        </Text>
      </Animated.View>
    </View>
  );
}
