import type { LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { DropLoader } from '@/components/brand/DropLoader';

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
  /**
   * The inline drop loader over the label; the button keeps its width (canvas `YukleniyorInline`) and the
   * press is ignored. `loadingLabel` ("Kaydediliyor…") replaces the label while loading.
   */
  loading?: boolean;
  loadingLabel?: string;
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
  loadingLabel,
  disabled = false,
  icon,
  iconPosition = 'leading',
  accessibilityHint,
  className,
  testID,
}: Props) {
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
      {/* The label stays laid out (invisible while loading) so the width never changes. */}
      {/* A label that does not fit (two bar buttons side by side on a 4.7" screen) shrinks a little instead of
          ending in "…" — "Lookbook'a kaydet" on 23 Kombin oluşturucu; the board draws it at 14. */}
      <View className={`shrink flex-row items-center gap-2 ${loading ? 'opacity-0' : ''}`}>
        {icon && iconPosition === 'leading' ? <Icon icon={icon} tone={contentTone} size={18} /> : null}
        <Text variant="button" tone={contentTone} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} className="shrink">
          {label}
        </Text>
        {icon && iconPosition === 'trailing' ? <Icon icon={icon} tone={contentTone} size={16} /> : null}
      </View>
      {loading ? (
        <View className="absolute inset-0 flex-row items-center justify-center gap-2" pointerEvents="none">
          <DropLoader size="inline" tone={filled ? 'cream' : 'ink'} accessibilityLabel={loadingLabel ?? label} />
          {loadingLabel ? (
            <Text variant="button" tone={contentTone} numberOfLines={1}>
              {loadingLabel}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}
