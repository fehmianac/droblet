import Svg, { Path, Rect } from 'react-native-svg';

import { sizes, type ColorPalette } from '@/theme/tokens';
import { useThemeColors } from '@/theme/useThemeColors';

type Props = { size?: number; tone?: keyof ColorPalette };

/**
 * The brand's hanger, as the canvas draws it on "Parçamı tamamla" (21) and on the wardrobe-match card (22).
 * Lucide has no hanger; the path is the one of the Gardırop tab glyph.
 */
export function HangerGlyph({ size = 20, tone = 'ink' }: Props) {
  const color = useThemeColors()[tone];
  const stroke = { stroke: color, strokeWidth: sizes.iconStroke, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
      <Path d="M10 6.5a2 2 0 1 1 2.6 1.9c-.4.2-.6.6-.6 1V10.5" {...stroke} />
      <Path d="M12 10.5 3.4 17.4c-.6.5-.3 1.6.5 1.6h16.2c.8 0 1.1-1.1.5-1.6z" {...stroke} />
    </Svg>
  );
}

/** The standing mirror of the "Üzerimde" switch (22). */
export function MirrorGlyph({ size = 15, tone = 'ink' }: Props) {
  const color = useThemeColors()[tone];
  const stroke = { stroke: color, strokeWidth: sizes.iconStroke, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
      <Rect x={6} y={3} width={12} height={15} rx={6} {...stroke} />
      <Path d="M12 18v3M8 21h8" {...stroke} />
    </Svg>
  );
}
