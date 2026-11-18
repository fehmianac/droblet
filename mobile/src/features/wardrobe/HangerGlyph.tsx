import type { LucideIcon, LucideProps } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';

/**
 * The brand's hanger, drawn exactly as on the canvas (the Gardırop tab and the circle of `DurumBos`).
 * Lucide has no hanger, so this takes the same props as a Lucide icon and can be handed to `<Icon icon=…>`
 * or to the `icon` of a state.
 */
function Hanger({ size = 24, color, strokeWidth = 1.5 }: LucideProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
      <Path d="M10 6.5a2 2 0 1 1 2.6 1.9c-.4.2-.6.6-.6 1V10.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path
        d="M12 10.5 3.4 17.4c-.6.5-.3 1.6.5 1.6h16.2c.8 0 1.1-1.1.5-1.6z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export const HangerGlyph = Hanger as unknown as LucideIcon;
