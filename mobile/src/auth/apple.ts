import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

import type { AppleAuthRequest } from '@/api/contracts';
import { ulid } from '@/lib/ids';

/**
 * Runs the native Sign in with Apple sheet. Apple receives SHA-256(rawNonce); the backend gets the
 * raw nonce and checks it against the token's `nonce` claim. Returns null when the user cancels.
 */
export async function requestAppleCredential(): Promise<AppleAuthRequest | null> {
  const rawNonce = `${ulid()}${ulid()}`;
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
    if (!credential.identityToken) return null;
    // Apple sends the name only on the very first authorization; the server stores it then.
    return {
      identityToken: credential.identityToken,
      nonce: rawNonce,
      givenName: credential.fullName?.givenName ?? null,
      familyName: credential.fullName?.familyName ?? null,
      // Exchanged by the server for an Apple refresh token, revoked when the account is deleted (App Store 5.1.1(v)).
      authorizationCode: credential.authorizationCode ?? null,
    };
  } catch (e) {
    if (e instanceof Error && 'code' in e && (e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return null;
    throw e;
  }
}
