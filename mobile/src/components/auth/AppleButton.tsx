import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

import { sizes } from '@/theme/tokens';

type Props = {
  onPress: () => void;
  /** Kept for callers; the label is "continue" in both modes, as on the canvas. */
  mode?: 'register' | 'login';
  disabled?: boolean;
};

/**
 * Native ASAuthorizationAppleIDButton — iOS only (App Store rule); hidden elsewhere. As on 02: the light,
 * outlined style with "Apple ile devam et" in both modes (the system draws and localises the label).
 */
export function AppleButton({ onPress, disabled = false }: Props) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    void AppleAuthentication.isAvailableAsync().then(setAvailable);
  }, []);
  if (!available) return null;
  return (
    <View className={disabled ? 'opacity-40' : ''} pointerEvents={disabled ? 'none' : 'auto'}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE_OUTLINE}
        cornerRadius={sizes.buttonPrimary / 2}
        style={{ height: sizes.buttonPrimary, width: '100%' }}
        onPress={onPress}
      />
    </View>
  );
}
