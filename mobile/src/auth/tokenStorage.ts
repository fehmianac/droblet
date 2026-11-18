import * as SecureStore from 'expo-secure-store';

import type { AuthUser } from '@/api/contracts';

/** Access + refresh tokens live in Keychain / Keystore only — never AsyncStorage (MOBILE_ENGINEER §Cihazdaki tokenlar). */
export type StoredSession = {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  user: AuthUser;
};

const KEY = 'droblet.session.v1';

export async function readSession(): Promise<StoredSession | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    await SecureStore.deleteItemAsync(KEY);
    return null;
  }
}

export async function writeSession(session: StoredSession): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}

export async function deleteSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
