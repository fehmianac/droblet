import { Shirt } from 'lucide-react-native';
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

import { SILHOUETTE_BODY_PATH, SILHOUETTE_HEAD, SILHOUETTE_LENGTH, SILHOUETTE_VIEWBOX } from '@/components/brand/logoPaths';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { motion, placeholderTones, type PlaceholderTone } from '@/theme/tokens';
import { useThemeColors } from '@/theme/useThemeColors';

import { Icon } from '../Icon';
import { Text } from '../Text';
import { AiReveal } from './AiReveal';
import { AiShimmer } from './AiShimmer';
import { brandEasing } from './motion';

const AnimatedPath = createAnimatedComponent(Path);

/**
 * A standing figure whose outline is drawn again and again (3.2 s: 70 % drawing, 30 % fading out).
 * With reduce-motion the outline is simply complete.
 */
export function AiSilhouetteTrace({ height = 317 }: { height?: number }) {
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();
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
      <Path d={SILHOUETTE_BODY_PATH} fill={colors.ink} opacity={0.08} />
      <AnimatedPath
        d={SILHOUETTE_BODY_PATH}
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

const PIECE_SLOTS = [
  { className: 'left-6 top-[26%]', tone: 'oat' },
  { className: 'right-6 top-[30%]', tone: 'dark' },
  { className: 'left-[30px] top-[62%]', tone: 'taupe' },
  { className: 'right-[30px] top-[66%]', tone: 'oat' },
] as const satisfies readonly { className: string; tone: PlaceholderTone }[];

/**
 * Up to four garment tiles gathering around the figure, 300 ms apart (1.2 s each, 4.8 s loop).
 * Absolutely fills its parent. `tones` lets a screen hint at the real pieces' colours.
 */
export function AiAssemblingPieces({ count = 4, tones }: { count?: number; tones?: readonly PlaceholderTone[] }) {
  return (
    <View className="absolute inset-0" pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
      {PIECE_SLOTS.slice(0, Math.max(0, Math.min(count, PIECE_SLOTS.length))).map((slot, i) => {
        const tone = tones?.[i] ?? slot.tone;
        return (
          <AiReveal key={slot.className} index={i} preset="piece" className={`absolute ${slot.className}`}>
            <View
              className="h-[70px] w-[58px] items-center justify-center rounded-[10px]"
              style={{ backgroundColor: placeholderTones[tone] }}
            >
              <View className="opacity-50">
                <Icon icon={Shirt} size={24} tone={tone === 'dark' ? 'cream' : 'ink'} />
              </View>
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
};

/**
 * The full "Üzerimde gör" waiting stage (`AiYukleniyor.dc.html`): warm ground, shimmer, the traced
 * figure and the pieces assembling. Purely visual — pair it with `AiProgressLines` for the
 * screen-reader status.
 */
export function AiTryOnStage({ className, pieces = 4, tones, tag }: StageProps) {
  const { t } = useTranslation();
  const label = tag === undefined ? t('ai.preparingTag') : tag;
  return (
    <View
      className={`items-center justify-center overflow-hidden ${className ?? ''}`}
      style={{ backgroundColor: placeholderTones.stage }}
      accessibilityState={{ busy: true }}
    >
      <AiShimmer />
      <AiSilhouetteTrace />
      <AiAssemblingPieces count={pieces} tones={tones} />
      {label ? (
        <View className="absolute bottom-4 left-4 rounded-pill bg-accent px-2.5 py-1">
          <Text variant="eyebrow" tone="paper">
            {label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
