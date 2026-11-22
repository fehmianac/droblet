import { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';

import { useReduceMotion } from '@/hooks/useReduceMotion';

import { AiShimmer } from './ai/AiShimmer';

/** `sand` = the canvas `.skel`; `veil` = paper at 70 % for a button-shaped block sitting on a photo (11′ header). */
const TONES = { sand: 'bg-sand', veil: 'bg-paper/70' } as const;

type Props = {
  className?: string;
  /**
   * Canvas `.shim` (11′ Parça detayı iskeleti): a light band sweeps across the block instead of the pulse; the
   * block is static with reduce-motion. The block itself takes `className`, so it can flex in a row.
   */
  sweep?: boolean;
  tone?: keyof typeof TONES;
  testID?: string;
};

/**
 * Sand placeholder box (canvas `.skel`: sand, radius 12 unless `className` sets another) with a soft pulse
 * (static when reduce-motion is on). Loading = skeleton, never a spinner.
 */
export function Skeleton({ className, sweep = false, tone = 'sand', testID }: Props) {
  const reduceMotion = useReduceMotion();
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (reduceMotion || sweep) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.55, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduceMotion, sweep]);

  if (sweep) {
    return (
      <View className={`overflow-hidden ${TONES[tone]} ${className ?? ''}`} testID={testID} accessible={false} importantForAccessibility="no-hide-descendants">
        <AiShimmer band={0.6} from={-1.2} to={2.2} />
      </View>
    );
  }

  return (
    <Animated.View style={{ opacity }} testID={testID} accessible={false} importantForAccessibility="no-hide-descendants">
      <View className={`${TONES[tone]} ${className ?? ''}`} />
    </Animated.View>
  );
}

/** Caption-line widths of `DurumYukleniyor`, tile by tile (80 %, 60 %, 70 % …), so the grid does not look ruled. */
const CAPTION_WIDTHS = ['w-4/5', 'w-3/5', 'w-[70%]', 'w-[55%]', 'w-3/4', 'w-[65%]', 'w-[70%]', 'w-1/2', 'w-3/5'] as const;

type GridProps = {
  /** Default 3 × 3, the grid of `DurumYukleniyor`. */
  columns?: number;
  rows?: number;
  /** Size + radius of one tile, e.g. `h-[128px] rounded-image` (the default) or `aspect-[3/4] rounded-tile`. */
  tileClassName?: string;
  /** The 10-high line under each tile where the content has a caption (default `true`). */
  caption?: boolean;
};

/**
 * Loading state of a grid list, shaped like its content (`DurumYukleniyor`): tiles 10 apart in a row, rows
 * 12 apart, a short line under each tile. Lists with rows or cards build theirs from `Skeleton`.
 */
export function SkeletonGrid({ columns = 3, rows = 3, tileClassName = 'h-[128px] rounded-image', caption = true }: GridProps) {
  return (
    <View className="gap-3">
      {Array.from({ length: rows }, (_, row) => (
        <View key={row} className="flex-row gap-2.5">
          {Array.from({ length: columns }, (__, col) => (
            <View key={col} className="flex-1 gap-1.5">
              <Skeleton className={`w-full ${tileClassName}`} />
              {caption ? <Skeleton className={`h-2.5 rounded-[5px] ${CAPTION_WIDTHS[(row * columns + col) % CAPTION_WIDTHS.length]}`} /> : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
