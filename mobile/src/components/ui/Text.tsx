import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { maxFontScale, type TypeVariant } from '@/theme/tokens';

export type TextTone = 'ink' | 'muted' | 'accent' | 'danger' | 'paper' | 'cream';

const variantClass: Record<TypeVariant, string> = {
  display: 'text-display font-display',
  h2: 'text-h2 font-display',
  h3: 'text-h3 font-display-semibold',
  body: 'text-body font-sans',
  bodyMedium: 'text-bodyMedium font-sans-medium',
  caption: 'text-caption font-sans',
  eyebrow: 'text-eyebrow font-sans-medium',
  brand: 'text-brand font-sans-medium',
  button: 'text-button font-sans-medium',
  tab: 'text-tab font-sans',
  tabActive: 'text-tabActive font-sans-semibold',
  title: 'text-title font-sans-medium',
  chip: 'text-chip font-sans',
  segment: 'text-segment font-sans-medium',
  badge: 'text-badge font-sans-medium',
  tag: 'text-tag font-sans-medium',
  miss: 'text-miss font-sans-medium',
  price: 'text-price font-sans-medium',
  total: 'text-total font-sans-medium',
  label: 'text-label font-sans-medium',
  dot: 'text-dot font-sans-semibold',
};

const toneClass: Record<TextTone, string> = {
  ink: 'text-ink',
  muted: 'text-muted',
  accent: 'text-accent',
  danger: 'text-danger',
  paper: 'text-paper',
  cream: 'text-cream',
};

export type TextProps = RNTextProps & {
  variant?: TypeVariant;
  tone?: TextTone;
  className?: string;
};

/**
 * Typography primitive. Upper-case labels (eyebrow, brand) must already be upper-case in the
 * string — this component never transforms case. Headings cap Dynamic Type at 130%.
 */
export function Text({ variant = 'body', tone, className, ...rest }: TextProps) {
  const resolvedTone = tone ?? (variant === 'eyebrow' ? 'muted' : 'ink');
  const isHeading = variant === 'display' || variant === 'h2' || variant === 'h3';
  return (
    <RNText
      accessibilityRole={isHeading ? 'header' : undefined}
      maxFontSizeMultiplier={maxFontScale[variant]}
      className={`${variantClass[variant]} ${toneClass[resolvedTone]} ${className ?? ''}`}
      {...rest}
    />
  );
}
