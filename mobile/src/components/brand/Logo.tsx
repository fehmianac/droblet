import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useThemeColors } from '@/theme/useThemeColors';

import { DROP_PATH, HANGER_BASE_PATH, HOOK_PATH, MARK_ASPECT, MARK_VIEWBOX } from './logoPaths';

type MarkProps = {
  /** Height in points; width follows the fixed 36:50 ratio. Minimum 16 (LogoKullanim). */
  height?: number;
  /** 'ink' = ink drop for cream/paper surfaces (default); 'cream' = cream drop for ink surfaces. */
  tone?: 'ink' | 'cream';
  /** Colour of the hook; defaults to the opposite of `tone`. Pass the surface colour when it is not cream/ink. */
  hookTone?: 'ink' | 'cream' | 'sand' | 'paper';
  /** Announced by screen readers when set; decorative otherwise. */
  accessibilityLabel?: string;
};

/** The symbol alone (drop + hanger hook). */
export function LogoMark({ height = 28, tone = 'ink', hookTone, accessibilityLabel }: MarkProps) {
  const colors = useThemeColors();
  const fill = tone === 'ink' ? colors.ink : colors.cream;
  const stroke = colors[hookTone ?? (tone === 'ink' ? 'cream' : 'ink')];
  const size = Math.max(16, height);
  // Small sizes need a heavier hook to stay legible; at icon-small sizes only the hanger base remains.
  const tiny = size < 20;
  const strokeWidth = tiny ? 3.4 : size <= 36 ? 2.6 : 2.2;
  return (
    <Svg
      width={size * MARK_ASPECT}
      height={size}
      viewBox={MARK_VIEWBOX}
      accessible={Boolean(accessibilityLabel)}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
    >
      <Path d={DROP_PATH} fill={fill} />
      <Path
        d={tiny ? HANGER_BASE_PATH : HOOK_PATH}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

type LockupProps = {
  /** 'header' = 20 × 28 mark + 26 serif (screen headers); 'large' = vertical lock-up (splash, welcome). */
  size?: 'header' | 'large';
  tone?: 'ink' | 'cream';
};

/**
 * Symbol + "Droblet" wordmark (Cormorant Garamond 500). Horizontal in headers, vertical when large.
 * Announced once as the brand name.
 */
export function Logo({ size = 'header', tone = 'ink' }: LockupProps) {
  const { t } = useTranslation();
  const large = size === 'large';
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={t('brand.name')}
      className={large ? 'items-center gap-4' : 'flex-row items-center gap-[7px]'}
    >
      <LogoMark height={large ? 128 : 28} tone={tone} />
      <RNText
        accessible={false}
        maxFontSizeMultiplier={1.3}
        className={`font-display ${large ? 'text-[54px] leading-[56px]' : 'text-[26px] leading-[30px]'} ${
          tone === 'ink' ? 'text-ink' : 'text-cream'
        }`}
      >
        {t('brand.name')}
      </RNText>
    </View>
  );
}
