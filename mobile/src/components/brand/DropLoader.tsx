import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  createAnimatedComponent,
  Easing,
  interpolate,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { Text } from '@/components/ui/Text';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { motion } from '@/theme/tokens';
import { useThemeColors } from '@/theme/useThemeColors';

import { DROP_LENGTH, DROP_PATH, HOOK_LENGTH, HOOK_PATH, MARK_ASPECT, MARK_VIEWBOX } from './logoPaths';

const AnimatedPath = createAnimatedComponent(Path);

/** One loop of the splash's drop mark (ms): the outline draws in, the drop fills, holds, fades and repeats. */
export const DROP_LOADER_LOOP_MS = 1600;
/** Phases of one loop, as fractions of `DROP_LOADER_LOOP_MS`. */
export const DROP_LOADER_PHASES = {
  /** 0 → 0.45 outline draws in. */
  outlineEnd: 0.45,
  /** 0.3 → 0.55 the drop fills; the hook draws 0.4 → 0.6. */
  fillStart: 0.3,
  fillEnd: 0.55,
  hookStart: 0.4,
  hookEnd: 0.6,
  /** 0.6 → 0.85 hold; 0.85 → 1 fades out. */
  fadeStart: 0.85,
} as const;

const SIZES = { screen: 64, inline: 20 } as const;
export type DropLoaderSize = keyof typeof SIZES;

type Props = {
  /** `screen`: 64-wide mark centred on cream, filling the space the content will take (first load, no cache). `inline`: 20 wide, for buttons and sections. */
  size?: DropLoaderSize;
  /** One quiet line under the mark (screen size only). */
  caption?: string;
  /** Screen-reader name ("Gardırop yükleniyor"); default "Yükleniyor". */
  accessibilityLabel?: string;
  /** Tone of the mark: ink on cream/paper, cream on a filled button. */
  tone?: 'ink' | 'cream';
  /** The filled mark without the loop (a status that is not work in progress, e.g. "offline"). */
  still?: boolean;
  testID?: string;
};

/**
 * The one loader of the app: the splash's drop mark in a 1.6 s loop (cubic-bezier(0.2, 0.8, 0.2, 1)).
 * Reduce motion: the filled mark, still. The `screen` size takes `flex-1` so the final layout height is
 * already reserved — nothing jumps when the content arrives.
 */
export function DropLoader({ size = 'screen', caption, accessibilityLabel, tone = 'ink', still = false, testID }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion() || still;
  const progress = useSharedValue(reduceMotion ? 0.7 : 0);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(progress);
      progress.set(0.7);
      return;
    }
    progress.set(0);
    progress.set(withRepeat(withTiming(1, { duration: DROP_LOADER_LOOP_MS, easing: Easing.bezier(...motion.bezier) }), -1, false));
    return () => cancelAnimation(progress);
  }, [progress, reduceMotion]);

  const P = DROP_LOADER_PHASES;
  const outlineProps = useAnimatedProps(() => ({
    strokeDashoffset: DROP_LENGTH * (1 - interpolate(progress.value, [0, P.outlineEnd], [0, 1], 'clamp')),
    strokeOpacity: interpolate(progress.value, [P.fadeStart, 1], [1, 0], 'clamp'),
  }));
  const fillProps = useAnimatedProps(() => ({
    fillOpacity: Math.min(
      interpolate(progress.value, [P.fillStart, P.fillEnd], [0, 1], 'clamp'),
      interpolate(progress.value, [P.fadeStart, 1], [1, 0], 'clamp'),
    ),
  }));
  const hookProps = useAnimatedProps(() => {
    const drawn = interpolate(progress.value, [P.hookStart, P.hookEnd], [0, 1], 'clamp');
    return {
      strokeDashoffset: HOOK_LENGTH * (1 - drawn),
      strokeOpacity: drawn > 0 ? interpolate(progress.value, [P.fadeStart, 1], [1, 0], 'clamp') : 0,
    };
  });

  const width = SIZES[size];
  const ink = tone === 'cream' ? colors.cream : colors.ink;
  const ground = tone === 'cream' ? colors.ink : colors.cream;
  const mark = (
    <Svg width={width} height={width / MARK_ASPECT} viewBox={MARK_VIEWBOX}>
      <AnimatedPath d={DROP_PATH} fill={ink} animatedProps={fillProps} />
      <AnimatedPath d={DROP_PATH} fill="none" stroke={ink} strokeWidth={size === 'inline' ? 2.4 : 1.4} strokeDasharray={DROP_LENGTH} animatedProps={outlineProps} />
      <AnimatedPath
        d={HOOK_PATH}
        fill="none"
        stroke={ground}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={HOOK_LENGTH}
        animatedProps={hookProps}
      />
    </Svg>
  );

  const a11y = {
    accessible: true,
    accessibilityRole: 'progressbar' as const,
    accessibilityLabel: accessibilityLabel ?? t('a11y.loading'),
    accessibilityState: { busy: true },
  };

  if (size === 'inline') {
    return (
      <View {...a11y} testID={testID} className="items-center justify-center">
        {mark}
      </View>
    );
  }
  return (
    <View {...a11y} testID={testID} className="flex-1 items-center justify-center gap-4 bg-cream px-gutter">
      <Animated.View>{mark}</Animated.View>
      {caption ? (
        <Text variant="caption" tone="muted" numberOfLines={1} className="text-center">
          {caption}
        </Text>
      ) : null}
    </View>
  );
}
