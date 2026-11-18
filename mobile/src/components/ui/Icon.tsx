import type { LucideIcon } from 'lucide-react-native';

import { sizes, type ColorPalette } from '@/theme/tokens';
import { useThemeColors } from '@/theme/useThemeColors';

type Props = {
  icon: LucideIcon;
  tone?: keyof ColorPalette;
  size?: number;
  filled?: boolean;
};

/** Lucide icon with the design-system stroke (1.5, round caps). Decorative by default. */
export function Icon({ icon: IconComponent, tone = 'ink', size = sizes.icon, filled = false }: Props) {
  const colors = useThemeColors();
  return (
    <IconComponent
      size={size}
      color={colors[tone]}
      fill={filled ? colors[tone] : 'none'}
      strokeWidth={sizes.iconStroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessible={false}
    />
  );
}
