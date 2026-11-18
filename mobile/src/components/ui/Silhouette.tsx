import Svg, { Circle, Path } from 'react-native-svg';

import { SILHOUETTE_BODY_PATH, SILHOUETTE_HEAD, SILHOUETTE_VIEWBOX } from '@/components/brand/logoPaths';
import { useThemeColors } from '@/theme/useThemeColors';

type Props = {
  /** Height in points; width follows the 60:100 figure box. */
  height: number;
  tone?: 'ink' | 'cream';
  /** 0.16 on the canvas look placeholders. */
  opacity?: number;
};

/**
 * The standing figure the canvas draws inside look / "on you" placeholders (01 collage, 06, 08, 17, 22).
 * Decorative: it stands in for a photograph that is not there yet.
 */
export function Silhouette({ height, tone = 'ink', opacity = 0.16 }: Props) {
  const colors = useThemeColors();
  const fill = tone === 'ink' ? colors.ink : colors.cream;
  return (
    <Svg width={height * 0.6} height={height} viewBox={SILHOUETTE_VIEWBOX} opacity={opacity} accessible={false}>
      <Circle {...SILHOUETTE_HEAD} fill={fill} />
      <Path d={SILHOUETTE_BODY_PATH} fill={fill} />
    </Svg>
  );
}
