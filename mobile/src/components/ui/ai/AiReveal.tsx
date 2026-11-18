import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { useReduceMotion } from '@/hooks/useReduceMotion';
import { motion, placeholderTones, type PlaceholderTone } from '@/theme/tokens';

import { Text } from '../Text';
import { revealTiming, useRevealLoop } from './motion';

export type RevealPreset = 'chip' | 'swatch' | 'day' | 'piece' | 'card';

/** Timings from `AiYukleniyorVaryantlar.dc.html` (ms). */
const PRESETS: Record<
  RevealPreset,
  { staggerMs: number; cycleMs: number; enterMs: number; exitMs: number; exitAt: number; y: number; scale: number; leadMs?: number }
> = {
  /** Tag chips while an item is being labelled: 400 in, 350 apart, 4 s loop. */
  chip: { staggerMs: 350, cycleMs: 4000, enterMs: 400, exitMs: 800, exitAt: 1, y: 6, scale: 0.96 },
  /** Palette tones: 400 in, 150 apart, 4 s loop. */
  swatch: { staggerMs: 150, cycleMs: 4000, enterMs: 400, exitMs: 800, exitAt: 1, y: 6, scale: 0.96 },
  /** Trip day boxes: 400 in, 300 apart, 4 s loop. */
  day: { staggerMs: 300, cycleMs: 4000, enterMs: 400, exitMs: 800, exitAt: 1, y: 6, scale: 0.96 },
  /** Pieces assembling around the silhouette: 1.2 s in, 300 apart, 4.8 s loop. */
  piece: { staggerMs: motion.pieceStaggerMs, cycleMs: 4800, enterMs: 1200, exitMs: 1200, exitAt: 1, y: 14, scale: 0.9 },
  /** Suggestion cards filling in (`stFill`): hidden 10 %, in until 30 %, shown until 85 %, out by 100 %; 500 apart, 4.5 s loop. */
  card: { staggerMs: 500, cycleMs: 4500, leadMs: 450, enterMs: 900, exitMs: 675, exitAt: 1, y: 0, scale: 0.98 },
};

type Props = {
  /** Position in the group — sets the stagger delay. */
  index: number;
  preset: RevealPreset;
  children?: ReactNode;
  /** Layout of the slot (position / size). Visuals belong to the child, which is what animates. */
  className?: string;
  /** Stretch the animated child to the slot (use when the slot has a fixed size). */
  fill?: boolean;
};

/**
 * One element of a staggered, looping reveal (chips, swatches, day boxes, pieces, cards): rises and
 * fades in, holds, fades out, repeats. With reduce-motion it is simply shown (cards stay hidden so
 * the skeleton underneath remains the static state, as in the design).
 */
export function AiReveal({ index, preset, children, className, fill = false }: Props) {
  const reduceMotion = useReduceMotion();
  const p = PRESETS[preset];
  const timing = revealTiming({ index, staggerMs: p.staggerMs, cycleMs: p.cycleMs, enterMs: p.enterMs, exitMs: p.exitMs, exitAt: p.exitAt, leadMs: p.leadMs });
  const v = useRevealLoop(timing, reduceMotion);
  const staticOpacity = preset === 'card' ? 0 : 1;
  const style = useAnimatedStyle(() => {
    if (reduceMotion) return { opacity: staticOpacity, transform: [{ translateY: 0 }, { scale: 1 }] };
    const enter = Math.min(v.value, 1);
    return {
      opacity: v.value <= 1 ? v.value : 2 - v.value,
      transform: [{ translateY: (1 - enter) * p.y }, { scale: p.scale + (1 - p.scale) * enter }],
    };
  });
  return (
    <View className={className}>
      <Animated.View style={[fill ? styles.fill : null, style]}>{children}</Animated.View>
    </View>
  );
}

/** Tag chips appearing one by one while AI labels a piece ("Gömlek · Beyaz · Pamuk"). */
export function AiChipReveal({ labels }: { labels: string[] }) {
  return (
    <View className="flex-row flex-wrap gap-1.5" accessible={false} importantForAccessibility="no-hide-descendants">
      {labels.map((label, i) => (
        <AiReveal key={`${label}${i}`} index={i} preset="chip">
          {/* Canvas `.badge`: 22 high, sand, Jost 500 11. */}
          <View className="h-badge items-center justify-center rounded-pill bg-sand px-2">
            <Text variant="badge" maxFontSizeMultiplier={1.3} numberOfLines={1}>
              {label}
            </Text>
          </View>
        </AiReveal>
      ))}
    </View>
  );
}

type SwatchProps = {
  /** Colours to reveal. Raw values come from data (palette analysis) or from `toneColor()`. */
  colors: readonly string[];
  /** 'swatch' = 4-column grid of 56-high tiles; 'day' = one row of 84-high day boxes. */
  preset?: 'swatch' | 'day';
};

/** Colour tiles appearing one by one (palette tones, trip days). */
export function AiSwatchReveal({ colors, preset = 'swatch' }: SwatchProps) {
  const day = preset === 'day';
  return (
    <View className={`flex-row ${day ? 'gap-1.5' : 'flex-wrap gap-2'}`} accessible={false} importantForAccessibility="no-hide-descendants">
      {colors.map((color, i) => (
        <AiReveal key={`${color}${i}`} index={i} preset={preset} fill className={day ? 'h-[84px] flex-1' : 'h-14 w-[22%] grow'}>
          <View className={`flex-1 ${day ? 'rounded-[8px]' : 'rounded-[10px]'}`} style={{ backgroundColor: color }} />
        </AiReveal>
      ))}
    </View>
  );
}

/** Default neutral tones for day boxes / cards when no real colour is known yet. */
export const AI_NEUTRAL_TONES: readonly PlaceholderTone[] = ['dark', 'taupe', 'clay', 'stage', 'camel'];
export const toneColor = (tone: PlaceholderTone): string => placeholderTones[tone];

const styles = StyleSheet.create({ fill: { flex: 1 } });
