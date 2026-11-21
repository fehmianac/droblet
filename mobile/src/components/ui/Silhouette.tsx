import Svg, { Circle, Path } from 'react-native-svg';

import { SILHOUETTE_HEAD, SILHOUETTE_VIEWBOX, silhouetteBodyPath } from '@/components/brand/logoPaths';
import { useSegment } from '@/features/segment/store';
import { useThemeColors } from '@/theme/useThemeColors';

type Props = {
  /** Height in points; width follows the 60:100 figure box. */
  height: number;
  tone?: 'ink' | 'cream';
  /** 0.16 on the canvas look placeholders. */
  opacity?: number;
  /** Women's or men's figure; defaults to the signed-in user's segment (canvas 17). */
  variant?: 'women' | 'men';
};

/**
 * The standing figure the canvas draws inside look / "on you" placeholders (01 collage, 06, 08, 17, 22).
 * Decorative: it stands in for a photograph that is not there yet.
 */
export function Silhouette({ height, tone = 'ink', opacity = 0.16, variant }: Props) {
  const colors = useThemeColors();
  const segment = useSegment();
  const figure = variant ?? segment;
  const fill = tone === 'ink' ? colors.ink : colors.cream;
  return (
    <Svg width={height * 0.6} height={height} viewBox={SILHOUETTE_VIEWBOX} opacity={opacity} accessible={false} testID={`silhouette-${figure}`}>
      <Circle {...SILHOUETTE_HEAD} fill={fill} />
      <Path d={silhouetteBodyPath(figure)} fill={fill} />
    </Svg>
  );
}
