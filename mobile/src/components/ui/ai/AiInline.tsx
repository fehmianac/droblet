import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { LogoMark } from '@/components/brand/Logo';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useThemeColors } from '@/theme/useThemeColors';

import { Text } from '../Text';
import { AiShimmer } from './AiShimmer';
import { brandEasing, usePulse } from './motion';

type PulseProps = {
  height?: number;
  tone?: 'ink' | 'cream';
};

/** The breathing logo mark: scale 1 → 1.06, opacity .7 → 1, 1.6 s, back and forth. Droblet's replacement for a spinner. */
export function AiDropPulse({ height = 20, tone = 'ink' }: PulseProps) {
  const reduceMotion = useReduceMotion();
  const pulse = usePulse(reduceMotion);
  const style = useAnimatedStyle(() => ({
    opacity: 0.7 + 0.3 * pulse.value,
    transform: [{ scale: 1 + 0.06 * pulse.value }],
  }));
  return (
    <Animated.View style={style} accessible={false} importantForAccessibility="no-hide-descendants">
      <LogoMark height={height} tone={tone} />
    </Animated.View>
  );
}

type InlineProps = {
  /** Defaults to "Görsel hazırlanıyor". */
  label?: string;
  /** Right-aligned note, e.g. "1 kredi". */
  trailing?: string;
};

/** Small inline variant for cards and rows: breathing drop + label (+ credit note). */
export function AiInlineStatus({ label, trailing }: InlineProps) {
  const { t } = useTranslation();
  const text = label ?? t('ai.imagePreparing');
  return (
    <View
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={trailing ? `${text}, ${trailing}` : text}
      accessibilityState={{ busy: true }}
      className="flex-row items-center gap-2.5 rounded-image-lg border border-line px-3 py-2.5"
    >
      <AiDropPulse height={21} />
      <Text variant="body" className="flex-1 text-[13px]" numberOfLines={2}>
        {text}
      </Text>
      {trailing ? (
        <Text variant="caption" tone="muted">
          {trailing}
        </Text>
      ) : null}
    </View>
  );
}

/** Primary-button-shaped busy state ("Hazırlanıyor") — takes the place of a button while its AI action runs. */
export function AiBusyButton({ label }: { label?: string }) {
  const { t } = useTranslation();
  const text = label ?? t('ai.preparing');
  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={{ busy: true, disabled: true }}
      className="h-btn-primary flex-row items-center justify-center gap-2 overflow-hidden rounded-pill bg-ink px-6"
    >
      <AiShimmer />
      {/* 19 pt cream mark on the ink button (`AiYukleniyorVaryantlar`, "Satır içi"). */}
      <AiDropPulse height={19} tone="cream" />
      <Text variant="button" tone="paper" numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

type BarProps = {
  /** 0–1 from the server (e.g. processed / total). Omit for the looping, indeterminate bar. */
  progress?: number;
  /** Stagger position for indeterminate bars in a list (400 ms apart). */
  index?: number;
  accessibilityLabel?: string;
};

/**
 * Thin espresso progress bar (bulk-add rows). Determinate when `progress` is given; otherwise it
 * loops 0 → 100 % (2.4 s of a 3.2 s cycle). With reduce-motion an indeterminate bar rests at 60 %.
 */
export function AiProgressBar({ progress, index = 0, accessibilityLabel }: BarProps) {
  const reduceMotion = useReduceMotion();
  const colors = useThemeColors();
  const determinate = progress !== undefined;
  const clamped = Math.max(0, Math.min(1, progress ?? 0));
  const v = useSharedValue(determinate ? clamped : reduceMotion ? 0.6 : 0);

  useEffect(() => {
    if (determinate) {
      v.set(reduceMotion ? clamped : withTiming(clamped, { duration: 400, easing: brandEasing }));
      return;
    }
    if (reduceMotion) {
      cancelAnimation(v);
      v.set(0.6);
      return;
    }
    v.set(0);
    v.set(
      withDelay(
        index * 400,
        withRepeat(
          withSequence(withTiming(1, { duration: 2400, easing: brandEasing }), withTiming(1, { duration: 800 }), withTiming(0, { duration: 0 })),
          -1,
          false,
        ),
      ),
    );
    return () => cancelAnimation(v);
  }, [clamped, determinate, index, reduceMotion, v]);

  const style = useAnimatedStyle(() => ({ width: `${v.value * 100}%` }));
  return (
    <View
      className="h-1 overflow-hidden rounded-pill bg-sand"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={determinate ? { min: 0, max: 100, now: Math.round(clamped * 100) } : undefined}
    >
      <Animated.View style={[styles.fill, { backgroundColor: colors.accent }, style]} />
    </View>
  );
}

const styles = StyleSheet.create({ fill: { height: 4, borderRadius: 2 } });
