import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

import { sizes } from '@/theme/tokens';

type Props = { onPress: () => void; mode: 'register' | 'login'; disabled?: boolean };

/** Native ASAuthorizationAppleIDButton — iOS only (App Store rule); hidden elsewhere. */
export function AppleButton({ onPress, mode, disabled = false }: Props) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    void AppleAuthentication.isAvailableAsync().then(setAvailable);
  }, []);
  if (!available) return null;
  return (
    <View className={disabled ? 'opacity-40' : ''} pointerEvents={disabled ? 'none' : 'auto'}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={
          mode === 'register'
            ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
            : AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
        }
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={sizes.buttonPrimary / 2}
        style={{ height: sizes.buttonPrimary, width: '100%' }}
        onPress={onPress}
      />
    </View>
  );
}
