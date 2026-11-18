import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { useThemeColors } from '@/theme/useThemeColors';

import { Icon } from './Icon';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'text';

type Props = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** Shows a spinner instead of the label; the press is ignored. */
  loading?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  accessibilityHint?: string;
  className?: string;
  testID?: string;
};

const containerClass: Record<ButtonVariant, string> = {
  // Primary 52 high, filled ink, full pill.
  primary: 'h-btn-primary rounded-pill bg-ink px-6',
  // Secondary 44 high, outlined.
  secondary: 'h-btn-secondary rounded-pill border border-ink bg-transparent px-5',
  // Text link — still a 44 pt touch target.
  text: 'min-h-btn-secondary px-2',
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon,
  accessibilityHint,
  className,
  testID,
}: Props) {
  const colors = useThemeColors();
  const inactive = disabled || loading;
  const contentTone = variant === 'primary' ? 'paper' : variant === 'text' ? 'accent' : 'ink';
  return (
    <Pressable
      testID={testID}
      onPress={inactive ? undefined : onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, busy: loading }}
      className={`flex-row items-center justify-center active:opacity-80 ${containerClass[variant]} ${
        disabled ? 'opacity-40' : ''
      } ${className ?? ''}`}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.paper : colors.ink} />
      ) : (
        <View className="flex-row items-center gap-2">
          {icon ? <Icon icon={icon} tone={contentTone} size={18} /> : null}
          <Text variant="button" tone={contentTone} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
