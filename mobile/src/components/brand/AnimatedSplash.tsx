import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text as RNText, View } from 'react-native';
import Animated, {
  createAnimatedComponent,
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { Text } from '@/components/ui/Text';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { motion } from '@/theme/tokens';
import { useThemeColors } from '@/theme/useThemeColors';

import { DROP_LENGTH, DROP_PATH, HOOK_LENGTH, HOOK_PATH, MARK_ASPECT, MARK_VIEWBOX } from './logoPaths';

const AnimatedPath = createAnimatedComponent(Path);

const EASE = Easing.bezier(...motion.bezier);
const LETTERS = ['D', 'r', 'o', 'b', 'l', 'e', 't'] as const;

/**
 * Timeline from `Splash.dc.html` / `SplashKareler.dc.html` (ms). Total 2600.
 * 0–900 outline draws · 700–1200 fill fades in · 1000–1500 hook draws · letters rise from 1200,
 * 60 apart, 500 each · 1800–2600 mark settles 104% → 100% · 2000–2400 espresso rule · 2100–2600 tagline.
 */
export const SPLASH_TIMELINE = {
  outline: { delay: 0, duration: 900 },
  fill: { delay: 700, duration: 500 },
  hook: { delay: 1000, duration: 500 },
  letters: { delay: 1200, stagger: 60, duration: 500, rise: 10 },
  settle: { delay: 1800, duration: 800, from: 1.04 },
  rule: { delay: 2000, duration: 400 },
  tagline: { delay: 2100, duration: 500 },
  total: motion.splashTotalMs,
  /** Cross-fade to the app after the last frame. */
  exit: 220,
} as const;

/** 92 wide, as on `Splash.dc.html` (92 × 108 box). */
const MARK_WIDTH = 92;

function Letter({ char, progress }: { char: string; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * SPLASH_TIMELINE.letters.rise }],
  }));
  return (
    <Animated.View style={style}>
      <RNText maxFontSizeMultiplier={1.3} className="font-display text-[54px] leading-[58px] tracking-[-0.54px] text-ink" accessible={false}>
        {char}
      </RNText>
    </Animated.View>
  );
}

function useProgress(delay: number, duration: number, reduceMotion: boolean): SharedValue<number> {
  const value = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) {
      value.set(1);
      return;
    }
    value.set(withDelay(delay, withTiming(1, { duration, easing: EASE })));
  }, [delay, duration, reduceMotion, value]);
  return value;
}

type Props = {
  /** Called once the last frame has been shown (and faded out). */
  onDone: () => void;
};

/**
 * 00 Splash — the in-app, animated continuation of the static native splash (same cream ground and
 * mark position, so the hand-over is seamless). With reduce-motion only the final frame is shown,
 * briefly, without movement.
 */
export function AnimatedSplash({ onDone }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();
  const T = SPLASH_TIMELINE;

  const outline = useProgress(T.outline.delay, T.outline.duration, reduceMotion);
  const fill = useProgress(T.fill.delay, T.fill.duration, reduceMotion);
  const hook = useProgress(T.hook.delay, T.hook.duration, reduceMotion);
  const settle = useProgress(T.settle.delay, T.settle.duration, reduceMotion);
  const rule = useProgress(T.rule.delay, T.rule.duration, reduceMotion);
  const tagline = useProgress(T.tagline.delay, T.tagline.duration, reduceMotion);
  const l0 = useProgress(T.letters.delay, T.letters.duration, reduceMotion);
  const l1 = useProgress(T.letters.delay + T.letters.stagger, T.letters.duration, reduceMotion);
  const l2 = useProgress(T.letters.delay + T.letters.stagger * 2, T.letters.duration, reduceMotion);
  const l3 = useProgress(T.letters.delay + T.letters.stagger * 3, T.letters.duration, reduceMotion);
  const l4 = useProgress(T.letters.delay + T.letters.stagger * 4, T.letters.duration, reduceMotion);
  const l5 = useProgress(T.letters.delay + T.letters.stagger * 5, T.letters.duration, reduceMotion);
  const l6 = useProgress(T.letters.delay + T.letters.stagger * 6, T.letters.duration, reduceMotion);
  const letters = [l0, l1, l2, l3, l4, l5, l6];

  const screen = useSharedValue(1);
  useEffect(() => {
    // Reduce motion: hold the final frame for a moment, then cut (no fade).
    const hold = reduceMotion ? 900 : T.total;
    const timer = setTimeout(() => {
      if (reduceMotion) {
        onDone();
        return;
      }
      screen.set(
        withTiming(0, { duration: T.exit, easing: Easing.inOut(Easing.ease) }, (finished) => {
          if (finished) runOnJS(onDone)();
        }),
      );
    }, hold);
    return () => clearTimeout(timer);
  }, [T.exit, T.total, onDone, reduceMotion, screen]);

  const screenStyle = useAnimatedStyle(() => ({ opacity: screen.value }));
  const markStyle = useAnimatedStyle(() => ({
    transform: [{ scale: T.settle.from - (T.settle.from - 1) * settle.value }],
  }));
  const outlineProps = useAnimatedProps(() => ({ strokeDashoffset: DROP_LENGTH * (1 - outline.value) }));
  const fillProps = useAnimatedProps(() => ({ fillOpacity: fill.value }));
  const hookProps = useAnimatedProps(() => ({
    strokeDashoffset: HOOK_LENGTH * (1 - hook.value),
    // A round cap would show as a dot before the stroke starts.
    strokeOpacity: hook.value > 0 ? 1 : 0,
  }));
  const ruleStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: rule.value }] }));
  const taglineStyle = useAnimatedStyle(() => ({ opacity: tagline.value }));

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.screen, { backgroundColor: colors.cream }, screenStyle]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${t('brand.name')}. ${t('splash.tagline')}`}
      testID="animated-splash"
    >
      {/* The mark sits exactly at the screen centre — where the native splash drew it. */}
      <View className="flex-1" />
      <Animated.View style={markStyle} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Svg width={MARK_WIDTH} height={MARK_WIDTH / MARK_ASPECT} viewBox={MARK_VIEWBOX}>
            <AnimatedPath d={DROP_PATH} fill={colors.ink} animatedProps={fillProps} />
            <AnimatedPath
              d={DROP_PATH}
              fill="none"
              stroke={colors.ink}
              strokeWidth={1.4}
              strokeDasharray={DROP_LENGTH}
              animatedProps={outlineProps}
            />
            <AnimatedPath
              d={HOOK_PATH}
              fill="none"
              stroke={colors.cream}
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={HOOK_LENGTH}
              animatedProps={hookProps}
            />
          </Svg>
      </Animated.View>
      <View className="flex-1 items-center gap-[18px] pt-[18px]" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <View className="flex-row">
          {LETTERS.map((char, i) => (
            <Letter key={`${char}${i}`} char={char} progress={letters[i] ?? l6} />
          ))}
        </View>
        <Animated.View style={ruleStyle}>
          <View className="h-[1.5px] w-10 bg-accent" />
        </Animated.View>
        <Animated.View style={taglineStyle}>
          <Text variant="body" tone="muted" className="text-[15px]">
            {t('splash.tagline')}
          </Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({ screen: { alignItems: 'center' } });
