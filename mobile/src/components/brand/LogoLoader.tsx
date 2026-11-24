import { useEffect } from "react";
import {
  cancelAnimation,
  createAnimatedComponent,
  Easing,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";

import { useReduceMotion } from "@/hooks/useReduceMotion";
import { brandTones, motion } from "@/theme/tokens";
import { useThemeColors } from "@/theme/useThemeColors";

import {
  D_LENGTH,
  D_PATH,
  D_STROKE_WIDTH,
  DROP_PATH,
  MARK_VIEWBOX,
  TILE,
} from "./logoPaths";

const AnimatedPath = createAnimatedComponent(Path);
const EASE = Easing.bezier(...motion.bezier);

/** One turn of the loop (ms): the "D" draws, the drop fades in, both hold, both fade out. */
export const LOGO_LOADER = {
  draw: 800,
  drop: 400,
  hold: 500,
  out: 300,
} as const;

/**
 * The splash mark as a loader (owner decision 2026-11-24): the rounded square stays, the "D" draws
 * and the drop fades in exactly as on 00 Splash, then both fade out and the turn repeats. With
 * reduce motion the finished mark is shown, still. Decorative: the caller carries the label.
 */
export function LogoLoader({
  size = 40,
  testID,
}: {
  size?: number;
  testID?: string;
}) {
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();
  const L = LOGO_LOADER;
  const stroke = useSharedValue(reduceMotion ? 1 : 0);
  const drop = useSharedValue(reduceMotion ? 1 : 0);
  const fade = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) {
      stroke.set(1);
      drop.set(1);
      fade.set(1);
      return;
    }
    const rest = L.drop * 0.5 + L.hold;
    stroke.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration: L.draw, easing: EASE }),
          withDelay(rest + L.out, withTiming(0, { duration: 0 })),
        ),
        -1,
      ),
    );
    drop.set(
      withRepeat(
        withSequence(
          withDelay(
            L.draw * 0.5,
            withTiming(1, { duration: L.drop, easing: EASE }),
          ),
          withDelay(L.hold + L.out, withTiming(0, { duration: 0 })),
        ),
        -1,
      ),
    );
    fade.set(
      withRepeat(
        withSequence(
          withDelay(L.draw + rest, withTiming(0, { duration: L.out })),
          withTiming(1, { duration: 0 }),
        ),
        -1,
      ),
    );
    return () => {
      cancelAnimation(stroke);
      cancelAnimation(drop);
      cancelAnimation(fade);
    };
  }, [L.draw, L.drop, L.hold, L.out, drop, fade, reduceMotion, stroke]);

  const strokeProps = useAnimatedProps(() => ({
    strokeDashoffset: D_LENGTH * (1 - stroke.value),
    // A round cap would show as a dot before the stroke starts.
    strokeOpacity: stroke.value > 0 ? fade.value : 0,
  }));
  const dropProps = useAnimatedProps(() => ({
    fillOpacity: drop.value * fade.value,
  }));

  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={size} height={size} viewBox={MARK_VIEWBOX}>
        <Rect
          x={TILE.x}
          y={TILE.y}
          width={TILE.size}
          height={TILE.size}
          rx={TILE.radius}
          fill={colors.ink}
        />
        <AnimatedPath
          d={D_PATH}
          fill="none"
          stroke={colors.cream}
          strokeWidth={D_STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={D_LENGTH}
          animatedProps={strokeProps}
        />
        <AnimatedPath
          d={DROP_PATH}
          fill={brandTones.dropOnInk}
          animatedProps={dropProps}
        />
      </Svg>
    </View>
  );
}
