import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { useThemeColors } from '@/theme/useThemeColors';

import { Icon } from './Icon';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'danger';
/** lg = 52 (primary, and the outlined pair of a primary), md = 44 (secondary), bar = 48 (inside the bottom action bar). */
export type ButtonSize = 'lg' | 'md' | 'bar';

type Props = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** Defaults: primary/danger 52, secondary/text 44. */
  size?: ButtonSize;
  /** Shows a spinner instead of the label; the press is ignored. */
  loading?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  /** Where the icon sits; 'trailing' for links that leave the app ("[Marka]'da öde"). Default 'leading'. */
  iconPosition?: 'leading' | 'trailing';
  accessibilityHint?: string;
  className?: string;
  testID?: string;
};

const containerClass: Record<ButtonVariant, string> = {
  // Filled ink, full pill (canvas `.btn`).
  primary: 'rounded-pill bg-ink px-6',
  // Outlined ink (canvas `.btn2`).
  secondary: 'rounded-pill border border-ink bg-transparent px-6',
  // Borderless text action — still a 44 pt touch target.
  text: 'px-2',
  // Destructive confirm (canvas `.btn.dg`): always carries its text.
  danger: 'rounded-pill bg-danger px-6',
};

const sizeClass: Record<ButtonSize, string> = {
  lg: 'h-btn-primary',
  md: 'h-btn-secondary',
  bar: 'h-btn-bar',
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size,
  loading = false,
  disabled = false,
  icon,
  iconPosition = 'leading',
  accessibilityHint,
  className,
  testID,
}: Props) {
  const colors = useThemeColors();
  const inactive = disabled || loading;
  const filled = variant === 'primary' || variant === 'danger';
  const contentTone = filled ? 'cream' : 'ink';
  const resolvedSize = size ?? (filled ? 'lg' : 'md');
  return (
    <Pressable
      testID={testID}
      onPress={inactive ? undefined : onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, busy: loading }}
      className={`flex-row items-center justify-center active:opacity-80 ${sizeClass[resolvedSize]} ${containerClass[variant]} ${
        disabled ? 'opacity-40' : ''
      } ${className ?? ''}`}
    >
      {loading ? (
        <ActivityIndicator color={filled ? colors.cream : colors.ink} />
      ) : (
        <View className="flex-row items-center gap-2">
          {icon && iconPosition === 'leading' ? <Icon icon={icon} tone={contentTone} size={18} /> : null}
          <Text variant="button" tone={contentTone} numberOfLines={1}>
            {label}
          </Text>
          {icon && iconPosition === 'trailing' ? <Icon icon={icon} tone={contentTone} size={16} /> : null}
        </View>
      )}
    </Pressable>
  );
}
