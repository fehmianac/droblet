import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { brandTones } from '@/theme/tokens';
import { useThemeColors } from '@/theme/useThemeColors';

import { D_PATH, D_STROKE_WIDTH, DROP_PATH, MARK_VIEWBOX, MIN_MARK_WIDTH, TILE } from './logoPaths';

type MarkProps = {
  /** Width (= height) in points. */
  width?: number;
  /** Same as `width` (the mark is square). Kept for the AI loading components. */
  height?: number;
  /** 'ink' = ink tile for cream/paper surfaces (default); 'cream' = cream tile for ink surfaces. */
  tone?: 'ink' | 'cream';
  /** Announced by screen readers when set; decorative otherwise. */
  accessibilityLabel?: string;
};

/** Colours of the mark per tile tone, as on `Logo.dc.html` (B): cream D + light espresso drop on ink, ink D + espresso drop on cream. */
export function markColors(tone: 'ink' | 'cream', colors: { ink: string; cream: string; accent: string }) {
  return tone === 'ink'
    ? { tile: colors.ink, stroke: colors.cream, drop: brandTones.dropOnInk }
    : { tile: colors.cream, stroke: colors.ink, drop: colors.accent };
}

/** The symbol alone (rounded square, hanger "D", drop). Never stretched, rotated or recoloured outside ink/cream. */
export function LogoMark({ width, height, tone = 'ink', accessibilityLabel }: MarkProps) {
  const colors = useThemeColors();
  const c = markColors(tone, colors);
  const w = Math.max(MIN_MARK_WIDTH, width ?? height ?? 20);
  return (
    <Svg
      width={w}
      height={w}
      viewBox={MARK_VIEWBOX}
      accessible={Boolean(accessibilityLabel)}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
    >
      <Rect x={TILE.x} y={TILE.y} width={TILE.size} height={TILE.size} rx={TILE.radius} fill={c.tile} />
      <Path d={D_PATH} fill="none" stroke={c.stroke} strokeWidth={D_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
      <Path d={DROP_PATH} fill={c.drop} />
    </Svg>
  );
}

export type LogoSize = 'header' | 'hero' | 'stacked';

type LockupProps = {
  /**
   * Proportions of the canvas lock-up (B): mark 1.1 × the wordmark size, gap 0.3 × the wordmark size.
   * 'header'  — horizontal, 28 mark + 26 wordmark, gap 8 (every tab-root header and the state boards).
   * 'hero'    — horizontal, 66 mark + 60 wordmark, gap 18 (01 Hoş geldin).
   * 'stacked' — vertical, 44 mark above a 28 wordmark, gap 6.
   */
  size?: LogoSize;
  tone?: 'ink' | 'cream';
};

const LOCKUP: Record<LogoSize, { mark: number; container: string; text: string }> = {
  header: { mark: 28, container: 'flex-row items-center gap-2', text: 'text-[26px] leading-[30px] tracking-[0.26px]' },
  hero: { mark: 66, container: 'flex-row items-center gap-[18px]', text: 'text-[60px] leading-[60px] tracking-[-1.2px]' },
  stacked: { mark: 44, container: 'items-center gap-1.5', text: 'text-[28px] leading-[32px]' },
};

/**
 * Symbol + "Droblet" wordmark (Cormorant Garamond 500): ink on cream/paper, cream on ink — espresso only
 * for the small drop. Keep at least `logoClearSpace(mark width)` free on every side.
 * Announced once as the brand name.
 */
export function Logo({ size = 'header', tone = 'ink' }: LockupProps) {
  const { t } = useTranslation();
  const spec = LOCKUP[size];
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={t('brand.name')} className={spec.container}>
      <LogoMark width={spec.mark} tone={tone} />
      <RNText
        accessible={false}
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
        className={`font-display ${spec.text} ${tone === 'ink' ? 'text-ink' : 'text-cream'}`}
      >
        {t('brand.name')}
      </RNText>
    </View>
  );
}
