import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import {
  createAnimatedComponent,
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { SILHOUETTE_HEAD, SILHOUETTE_LENGTH, SILHOUETTE_VIEWBOX, silhouetteBodyPath } from '@/components/brand/logoPaths';
import { useSegment } from '@/features/segment/store';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { motion, placeholderTones, type PlaceholderTone } from '@/theme/tokens';
import { useThemeColors } from '@/theme/useThemeColors';

import { ImageTag } from '../Bits';
import { AiReveal } from './AiReveal';
import { AiShimmer } from './AiShimmer';
import { brandEasing } from './motion';

const AnimatedPath = createAnimatedComponent(Path);

/**
 * A standing figure whose outline is drawn again and again (3.2 s: 70 % drawing, 30 % fading out).
 * With reduce-motion the outline is simply complete.
 */
export function AiSilhouetteTrace({ height = 317, paused = false }: { height?: number; paused?: boolean }) {
  const colors = useThemeColors();
  const segment = useSegment();
  const systemReduceMotion = useReduceMotion();
  const reduceMotion = systemReduceMotion || paused;
  // 0 → 1 draws, 1 → 2 fades.
  const v = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(v);
      v.set(1);
      return;
    }
    v.set(0);
    v.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration: motion.traceMs * 0.7, easing: brandEasing }),
          withTiming(2, { duration: motion.traceMs * 0.3, easing: Easing.linear }),
          withTiming(0, { duration: 0 }),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(v);
  }, [reduceMotion, v]);

  const traceProps = useAnimatedProps(() => ({
    strokeDashoffset: SILHOUETTE_LENGTH * (1 - Math.min(v.value, 1)),
    strokeOpacity: v.value <= 0 ? 0 : v.value <= 1 ? 1 : 2 - v.value,
  }));

  return (
    <Svg width={height * 0.6} height={height} viewBox={SILHOUETTE_VIEWBOX} accessible={false}>
      <Circle {...SILHOUETTE_HEAD} fill={colors.ink} opacity={0.08} />
      <Path d={silhouetteBodyPath(segment)} fill={colors.ink} opacity={0.08} />
      <AnimatedPath
        d={silhouetteBodyPath(segment)}
        fill="none"
        stroke={colors.accent}
        strokeWidth={0.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={SILHOUETTE_LENGTH}
        animatedProps={traceProps}
      />
    </Svg>
  );
}

/** Garment line glyphs of the board (24 × 24, stroke 1.1): top, jacket, trousers, shoe. */
const PIECE_GLYPHS = [
  'M8 3 3 6l2 4 3-1v12h8V9l3 1 2-4-5-3c-.5 1.5-2 2.5-4 2.5S8.5 4.5 8 3z',
  'M8 3 4 6v15h6V9l2 3 2-3v12h6V6l-4-3-2 4z',
  'M7 3h10l1 18h-4.2L12 10l-1.8 11H6z',
  'M3 16c0-2 .8-4.5 2-6.5l3 1c1 2 3 3 6 3l5 1c1.2.3 2 1.2 2 2.3V18H3z',
] as const;

/** Positions on the 470-high stage of `AiYukleniyor` (left/right 24 · 30, top 120 · 140 · 290 · 310), kept proportional. */
const PIECE_SLOTS = [
  { className: 'left-6 top-[25.5%]', tone: 'sand' },
  { className: 'right-6 top-[29.8%]', tone: 'dark' },
  { className: 'left-[30px] top-[61.7%]', tone: 'taupe' },
  { className: 'right-[30px] top-[66%]', tone: 'oat' },
] as const satisfies readonly { className: string; tone: PlaceholderTone | 'sand' }[];

/**
 * Up to four garment tiles gathering around the figure, 300 ms apart (1.2 s each, 4.8 s loop).
 * Absolutely fills its parent. `tones` lets a screen hint at the real pieces' colours.
 */
export function AiAssemblingPieces({ count = 4, tones }: { count?: number; tones?: readonly PlaceholderTone[] }) {
  const colors = useThemeColors();
  return (
    <View className="absolute inset-0" pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
      {PIECE_SLOTS.slice(0, Math.max(0, Math.min(count, PIECE_SLOTS.length))).map((slot, i) => {
        const tone = tones?.[i] ?? slot.tone;
        return (
          <AiReveal key={slot.className} index={i} preset="piece" className={`absolute ${slot.className}`}>
            <View
              className="h-[70px] w-[58px] items-center justify-center rounded-thumb"
              style={{ backgroundColor: tone === 'sand' ? colors.sand : placeholderTones[tone] }}
            >
              <Svg width={28} height={28} viewBox="0 0 24 24" opacity={0.55} accessible={false}>
                <Path d={PIECE_GLYPHS[i]} fill="none" stroke={tone === 'dark' ? colors.cream : colors.ink} strokeWidth={1.1} strokeLinejoin="round" />
              </Svg>
            </View>
          </AiReveal>
        );
      })}
    </View>
  );
}

type StageProps = {
  /** Size of the stage, e.g. `h-[470px] w-full` or `aspect-[4/5] w-full rounded-image-lg`. */
  className?: string;
  /** Number of pieces in the look (1–4). */
  pieces?: number;
  tones?: readonly PlaceholderTone[];
  /** Bottom-left tag; defaults to "SENİN ÜZERİNDE · HAZIRLANIYOR". Pass null to hide. */
  tag?: string | null;
  /** False = the wait stopped (timeout / failure): no shimmer, no pieces, the figure stands still. Default true. */
  active?: boolean;
};

/**
 * The full "Üzerimde gör" waiting stage (`AiYukleniyor.dc.html`): warm ground, shimmer, the traced
 * figure (190 × 317, 20 below the centre as drawn) and the pieces assembling. Purely visual — pair it
 * with `AiProgressLines` for the screen-reader status.
 */
export function AiTryOnStage({ className, pieces = 4, tones, tag, active = true }: StageProps) {
  const { t } = useTranslation();
  const label = tag === undefined ? t('ai.preparingTag') : tag;
  return (
    <View
      className={`items-center justify-center overflow-hidden ${className ?? ''}`}
      style={{ backgroundColor: placeholderTones.stage }}
      accessibilityState={{ busy: active }}
    >
      {active ? <AiShimmer /> : null}
      <View className="pt-10">
        <AiSilhouetteTrace paused={!active} />
      </View>
      {active ? <AiAssemblingPieces count={pieces} tones={tones} /> : null}
      {label ? <ImageTag label={label} className="absolute bottom-4 left-4" /> : null}
    </View>
  );
}
