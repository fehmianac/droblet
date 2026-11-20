import { useSyncExternalStore } from 'react';

import type { AuthResponse, AuthUser } from '@/api/contracts';

import { deleteSession, readSession, writeSession, type StoredSession } from './tokenStorage';

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut'; reason?: 'expired' | 'suspended' }
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

  /**
   * Stores a token pair. `user` is given at sign-in (name / e-mail from the form or the profile);
   * a refresh passes none and keeps the stored one.
   */
  async setFromAuthResponse(res: AuthResponse, user?: Partial<Omit<AuthUser, 'id'>>): Promise<void> {
    const previous = current?.user.id === res.userId ? current.user : null;
    const expiresAt = Date.parse(res.accessTokenExpiresAt);
    const nextUser: AuthUser = {
      id: res.userId,
      name: user?.name ?? previous?.name ?? '',
      email: user?.email ?? previous?.email ?? '',
    };
    const ageConfirmed = user?.ageConfirmed ?? previous?.ageConfirmed;
    if (ageConfirmed !== undefined) nextUser.ageConfirmed = ageConfirmed;
    const tenantId = res.tenantId || previous?.tenantId;
    if (tenantId) nextUser.tenantId = tenantId;
    current = {
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
      // An unreadable timestamp reads as "expired": the next request refreshes first.
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
      user: nextUser,
    };
    await writeSession(current);
    emit({ status: 'signedIn', user: nextUser });
  },

  /** Fills in the display name / e-mail once the profile is known (social sign-in, e-mail login). */
  async updateUser(patch: Partial<Omit<AuthUser, 'id'>>): Promise<void> {
    if (!current) return;
    const nextUser: AuthUser = { ...current.user, ...patch };
    if (nextUser.name === current.user.name && nextUser.email === current.user.email && nextUser.ageConfirmed === current.user.ageConfirmed) return;
    current = { ...current, user: nextUser };
    await writeSession(current);
    emit({ status: 'signedIn', user: nextUser });
  },

  /**
   * Clears tokens. The user's persisted query cache and mutation queue are keyed by user id and are
   * NOT deleted here — queued writes are the user's work and resume after the same user signs in.
   */
  async clear(reason?: 'expired' | 'suspended'): Promise<void> {
    current = null;
    await deleteSession();
    emit({ status: 'signedOut', reason });
  },
};

export function useSession(): SessionState {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.getState, sessionStore.getState);
}
