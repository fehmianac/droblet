import { useSyncExternalStore } from 'react';

import type { AuthResponse, AuthUser } from '@/api/contracts';

import { deleteSession, readSession, writeSession, type StoredSession } from './tokenStorage';

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut'; reason?: 'expired' }
  | { status: 'signedIn'; user: AuthUser };

let state: SessionState = { status: 'loading' };
let current: StoredSession | null = null;
const listeners = new Set<() => void>();

function emit(next: SessionState) {
  state = next;
  listeners.forEach((l) => l());
}

export const sessionStore = {
  getState: (): SessionState => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Tokens for the API client (not exposed to UI). */
  getTokens: (): StoredSession | null => current,

  async hydrate(): Promise<void> {
    current = await readSession();
    emit(current ? { status: 'signedIn', user: current.user } : { status: 'signedOut' });
  },

  async setFromAuthResponse(res: AuthResponse): Promise<void> {
    current = {
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
      expiresAt: Date.now() + res.expiresIn * 1000,
      user: res.user,
    };
    await writeSession(current);
    emit({ status: 'signedIn', user: res.user });
  },

  /**
   * Clears tokens. The user's persisted query cache and mutation queue are keyed by user id and are
   * NOT deleted here — queued writes are the user's work and resume after the same user signs in.
   */
  async clear(reason?: 'expired'): Promise<void> {
    current = null;
    await deleteSession();
    emit({ status: 'signedOut', reason });
  },
};

export function useSession(): SessionState {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.getState, sessionStore.getState);
}
