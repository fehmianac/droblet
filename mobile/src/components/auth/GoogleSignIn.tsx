import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import { googleClientIds } from '@/api/config';
import { GoogleButton } from '@/components/ui/GoogleButton';

WebBrowser.maybeCompleteAuthSession();

type Props = {
  onIdToken: (idToken: string) => void;
  onError: () => void;
  onUnavailable: () => void;
  loading: boolean;
  disabled?: boolean;
};

function hasClientIdForPlatform(): boolean {
  const ids = googleClientIds();
  if (Platform.OS === 'ios') return Boolean(ids.ios);
  if (Platform.OS === 'android') return Boolean(ids.android);
  return Boolean(ids.web);
}

function ConfiguredGoogleButton({ onIdToken, onError, loading, disabled }: Omit<Props, 'onUnavailable'>) {
  const { t } = useTranslation();
  const ids = googleClientIds();
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: ids.ios ?? undefined,
    androidClientId: ids.android ?? undefined,
    webClientId: ids.web ?? undefined,
  });

  useEffect(() => {
    if (!response) return;
    if (response.type === 'success') {
      const idToken = response.params.id_token;
      if (idToken) onIdToken(idToken);
      else onError();
    } else if (response.type === 'error') {
      onError();
    }
  }, [response, onIdToken, onError]);

  return (
    <GoogleButton
      label={t('auth.google')}
      loading={loading}
      disabled={disabled || !request}
      onPress={() => void promptAsync()}
    />
  );
}

/**
 * Google sign-in → `idToken` → `POST v1/auth/google`. Client ids come from env; when they are not
 * configured for this platform the button still shows and explains that Google sign-in is unavailable.
 */
export function GoogleSignIn(props: Props) {
  const { t } = useTranslation();
  if (!hasClientIdForPlatform()) {
    return <GoogleButton label={t('auth.google')} onPress={props.onUnavailable} disabled={props.disabled} />;
  }
  return <ConfiguredGoogleButton {...props} />;
}
