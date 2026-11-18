import { useEffect } from 'react';
import {
  cancelAnimation,
  Easing,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { motion } from '@/theme/tokens';

/** The shared easing of the AI loading language and the splash: cubic-bezier(0.2, 0.8, 0.2, 1). */
export const brandEasing = Easing.bezier(...motion.bezier);

export type RevealTiming = {
  /** Time before the element starts to appear inside each cycle (its stagger offset). */
  delayMs: number;
  /** Hidden time at the start of every cycle (e.g. the first 10 % of the stilist card fill). */
  leadMs?: number;
  enterMs: number;
  holdMs: number;
  exitMs: number;
  /** Idle time at the end so every element of a group shares the same cycle length. */
  restMs: number;
};

/**
 * Splits a looping cycle into delay → enter → hold → exit → rest for the element at `index`.
 * `stagger` is the gap between consecutive elements (e.g. pieces assemble 300 ms apart).
 */
export function revealTiming(options: {
  index: number;
  staggerMs: number;
  cycleMs: number;
  enterMs: number;
  exitMs: number;
  /** Fraction of the cycle (after the delay) at which the exit ends. */
  exitAt: number;
  /** Hidden time at the start of every cycle, before the entrance. Default 0. */
  leadMs?: number;
}): RevealTiming {
  const { index, staggerMs, cycleMs, enterMs, exitMs, exitAt } = options;
  const leadMs = Math.max(0, options.leadMs ?? 0);
  const delayMs = Math.max(0, index) * staggerMs;
  const exitStart = Math.max(leadMs + enterMs, cycleMs * exitAt - exitMs);
  const holdMs = Math.max(0, exitStart - leadMs - enterMs);
  const used = leadMs + enterMs + holdMs + exitMs;
  return { delayMs, leadMs, enterMs, holdMs, exitMs, restMs: Math.max(0, cycleMs - used) };
}

/**
 * Looping reveal value: 0 (hidden) → 1 (shown, brand easing) → hold → 2 (faded out) → back to 0.
 * With reduce-motion it stays at 1 (the static final state). Consumers map 0..1 to their entrance
 * transform and 1..2 to the fade-out.
 */
export function useRevealLoop(timing: RevealTiming, reduceMotion: boolean): SharedValue<number> {
  const value = useSharedValue(reduceMotion ? 1 : 0);
  const { delayMs, enterMs, holdMs, exitMs, restMs } = timing;
  const leadMs = timing.leadMs ?? 0;
  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(value);
      value.set(1);
      return;
    }
    value.set(0);
    value.set(
      withDelay(
        delayMs,
        withRepeat(
          withSequence(
            withDelay(leadMs, withTiming(1, { duration: enterMs, easing: brandEasing })),
            withDelay(holdMs, withTiming(2, { duration: exitMs, easing: Easing.inOut(Easing.ease) })),
            // Jump back to hidden, then rest until the next cycle.
            withTiming(0, { duration: 0 }),
            withTiming(0, { duration: Math.max(1, restMs) }),
          ),
          -1,
          false,
        ),
      ),
    );
    return () => cancelAnimation(value);
  }, [delayMs, enterMs, exitMs, holdMs, leadMs, reduceMotion, restMs, value]);
  return value;
}

/** Gentle "breathing" 0 ↔ 1, 1.6 s ease-in-out, back and forth (the drop pulse). Static 1 with reduce-motion. */
export function usePulse(reduceMotion: boolean, durationMs = 1600): SharedValue<number> {
  const value = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(value);
      value.set(1);
      return;
    }
    value.set(0);
    value.set(withRepeat(withTiming(1, { duration: durationMs, easing: Easing.inOut(Easing.ease) }), -1, true));
    return () => cancelAnimation(value);
  }, [durationMs, reduceMotion, value]);
  return value;
}
