import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useThemeColors } from '@/theme/useThemeColors';

import { DROP_PATH, HANGER_BASE_PATH, HOOK_PATH, MARK_ASPECT, MARK_VIEWBOX, MIN_MARK_WIDTH } from './logoPaths';

type MarkProps = {
  /** Width in points (the canvas sizes the mark by its box width: 20 in headers, 44 on 01, 92 on the splash). */
  width?: number;
  /** Alternative to `width`: the box height (36:42 box). Kept for the AI loading components. */
  height?: number;
  /** 'ink' = ink drop for cream/paper surfaces (default); 'cream' = cream drop for ink surfaces. */
  tone?: 'ink' | 'cream';
  /** Colour of the hook; defaults to the opposite of `tone`. Pass the surface colour when it is not cream/ink. */
  hookTone?: 'ink' | 'cream' | 'sand' | 'paper';
  /** Announced by screen readers when set; decorative otherwise. */
  accessibilityLabel?: string;
};

/** Hook stroke per size, as drawn on `LogoIkon`: 2.2 from 44 wide, 2.6 below, base only (3.4) at 18 and below (29 px icon, inline AI status). */
export function markStroke(width: number): { path: string; strokeWidth: number } {
  if (width <= 18) return { path: HANGER_BASE_PATH, strokeWidth: 3.4 };
  return { path: HOOK_PATH, strokeWidth: width <= 35 ? 2.6 : 2.2 };
}

/** The symbol alone (drop + hanger hook). Never stretched, rotated or recoloured outside ink/cream. */
export function LogoMark({ width, height, tone = 'ink', hookTone, accessibilityLabel }: MarkProps) {
  const colors = useThemeColors();
  const fill = tone === 'ink' ? colors.ink : colors.cream;
  const stroke = colors[hookTone ?? (tone === 'ink' ? 'cream' : 'ink')];
  const w = Math.max(MIN_MARK_WIDTH, width ?? (height !== undefined ? height * MARK_ASPECT : 20));
  const { path, strokeWidth } = markStroke(w);
  return (
    <Svg
      width={w}
      height={w / MARK_ASPECT}
      viewBox={MARK_VIEWBOX}
      accessible={Boolean(accessibilityLabel)}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
    >
      <Path d={DROP_PATH} fill={fill} />
      <Path d={path} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export type LogoSize = 'header' | 'hero' | 'stacked';

type LockupProps = {
  /**
   * 'header'  — horizontal, 20 mark + 26 wordmark, gap 7 (every tab-root header and the state boards).
   * 'hero'    — horizontal, 44 mark + 60 wordmark, gap 12 (01 Hoş geldin).
   * 'stacked' — vertical, 40 mark above a 28 wordmark, gap 4 (LogoKullanim "dikey").
   */
  size?: LogoSize;
  tone?: 'ink' | 'cream';
};

const LOCKUP: Record<LogoSize, { mark: number; container: string; text: string }> = {
  header: { mark: 20, container: 'flex-row items-center gap-[7px]', text: 'text-[26px] leading-[30px] tracking-[0.26px]' },
  hero: { mark: 44, container: 'flex-row items-center gap-3', text: 'text-[60px] leading-[60px] tracking-[-1.2px]' },
  stacked: { mark: 40, container: 'items-center gap-1', text: 'text-[28px] leading-[32px]' },
};

/**
 * Symbol + "Droblet" wordmark (Cormorant Garamond 500): ink on cream/paper, cream on ink — espresso is
 * never used for the logo. Keep at least `logoClearSpace(mark width)` free on every side.
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
