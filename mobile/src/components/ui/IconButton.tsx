import type { LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Icon } from './Icon';
import { Text } from './Text';

type Props = {
  icon: LucideIcon;
  /** Required: screen readers announce this (BRIEF §3 Erişilebilirlik). */
  accessibilityLabel: string;
  onPress: () => void;
  variant?: 'outline' | 'plain' | 'inverse';
  /** Filled glyph, e.g. a saved heart. */
  active?: boolean;
  /** Small count badge (accent), e.g. cart items. */
  badge?: number;
  disabled?: boolean;
  className?: string;
};

const variantClass = {
  outline: 'border border-line bg-paper',
  plain: 'bg-transparent',
  inverse: 'bg-paper/90',
} as const;

/** Round 44×44 icon button. */
export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  variant = 'outline',
  active = false,
  badge,
  disabled = false,
  className,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected: active }}
      hitSlop={4}
      className={`h-icon-btn w-icon-btn items-center justify-center rounded-pill active:opacity-70 ${
        variantClass[variant]
      } ${disabled ? 'opacity-40' : ''} ${className ?? ''}`}
    >
      <Icon icon={icon} filled={active} size={20} />
      {badge !== undefined && badge > 0 ? (
        <View
          className="absolute -right-0.5 -top-0.5 min-w-5 h-5 items-center justify-center rounded-pill bg-accent px-1"
          accessible={false}
        >
          <Text variant="caption" tone="paper" maxFontSizeMultiplier={1.2}>
            {String(badge)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
