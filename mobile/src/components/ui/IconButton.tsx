import type { LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Icon } from './Icon';
import { Text } from './Text';

type Props = {
  icon: LucideIcon;
  /** Required: screen readers announce this (BRIEF §3 Erişilebilirlik). */
  accessibilityLabel: string;
  onPress: () => void;
  /**
   * outline — line border on the screen colour (canvas `.ib`, the default).
   * plain   — no border (back / close).
   * inverse — paper at 90 % for buttons sitting on an image.
   * filled  — ink circle, cream glyph: the primary "+" action in a header.
   */
  variant?: 'outline' | 'plain' | 'inverse' | 'filled';
  /** Filled glyph, e.g. a saved heart. */
  active?: boolean;
  /** Small count dot (accent), e.g. cart items. */
  badge?: number;
  disabled?: boolean;
  /** Glyph size; 20 in round buttons, 22 for back chevrons. */
  iconSize?: number;
  className?: string;
  testID?: string;
};

const variantClass = {
  outline: 'border border-line bg-transparent',
  plain: 'bg-transparent',
  inverse: 'bg-paper/90',
  filled: 'border border-ink bg-ink',
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
  iconSize = 20,
  className,
  testID,
}: Props) {
  return (
    <Pressable
      testID={testID}
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
      <Icon icon={icon} filled={active} size={iconSize} tone={variant === 'filled' ? 'cream' : 'ink'} />
      {badge !== undefined && badge > 0 ? <CountDot count={badge} className="absolute -right-1 -top-1" /> : null}
    </Pressable>
  );
}

/** Accent count dot (canvas `.dot`): 18 high, Jost 600 10, paper text. */
export function CountDot({ count, className }: { count: number; className?: string }) {
  return (
    <View className={`h-dot min-w-dot items-center justify-center rounded-pill bg-accent px-1 ${className ?? ''}`} accessible={false}>
      <Text variant="dot" tone="paper">
        {String(count)}
      </Text>
    </View>
  );
}
