import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Text } from '@/components/ui/Text';
import { useThemeColors } from '@/theme/useThemeColors';

type Props = {
  onPress: () => void;
  /** Kept for callers; the label is "continue" in both modes, as on the canvas. */
  mode?: 'register' | 'login';
  disabled?: boolean;
};

/** Apple logo as drawn on `Kayit.dc.html` (24 × 24). */
const APPLE_LOGO =
  'M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8s2.3-1.3 3.1-2.5c1-1.4 1.4-2.8 1.4-2.9-.1 0-2.7-1-2.7-4.1zM13.9 5c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3-1.5z';

/**
 * "Apple ile devam et" exactly as on 02: a 52-high paper pill with a line border, the Apple logo in ink
 * and the label in the button type style. iOS only (App Store rule); hidden where Sign in with Apple is
 * not available. (The system button cannot take the canvas typography: it scales its label with its height.)
 */
export function AppleButton({ onPress, disabled = false }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    void AppleAuthentication.isAvailableAsync().then(setAvailable);
  }, []);
  if (!available) return null;
  return (
    <Pressable
      testID="auth.apple"
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={t('auth.apple')}
      accessibilityState={{ disabled }}
      className={`h-btn-primary flex-row items-center justify-center gap-2 rounded-pill border border-line bg-paper active:opacity-80 ${
        disabled ? 'opacity-40' : ''
      }`}
    >
      <Svg width={18} height={18} viewBox="0 0 24 24" accessible={false}>
        <Path d={APPLE_LOGO} fill={colors.ink} />
      </Svg>
      <Text variant="button" numberOfLines={1}>
        {t('auth.apple')}
      </Text>
    </Pressable>
  );
}
