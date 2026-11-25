import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

import { apiRequest } from '@/api/client';
import { ApiError } from '@/api/errors';

/**
 * Per-user onboarding progress on this device. Register → 'pending' (03 → 04 → 04b → 05);
 * email login → 'done' (BRIEF 02: successful login goes to 06). Social sign-in may be a new
 * account, so it starts 'pending'; 03 prefills from the server profile when one exists.
 *
 * A device with a session but no record (the app was deleted and installed again: iOS keeps the session in the
 * keychain, the record is gone) asks the server once: an account that has a style profile already went through
 * onboarding and opens on Akış.
 */
export type OnboardingStatus = 'unknown' | 'pending' | 'done';

const key = (userId: string) => `droblet.onboarding.${userId}`;
const statuses = new Map<string, OnboardingStatus>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const SERVER_WAIT_MS = 6000;

/** 'done' when the account has a style profile, 'pending' when it has none, null when the server gave no answer in time. */
async function askServer(): Promise<'pending' | 'done' | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), SERVER_WAIT_MS);
  });
  const ask = apiRequest<unknown>('v1/tenant/style-profile')
    .then((): 'done' => 'done')
    .catch((e: unknown) => (e instanceof ApiError && e.status === 404 ? ('pending' as const) : null));
  try {
    return await Promise.race([ask, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function set(userId: string, status: 'pending' | 'done') {
  statuses.set(userId, status);
  emit();
  await AsyncStorage.setItem(key(userId), status);
}

export const onboardingStore = {
  markPending: (userId: string) => set(userId, 'pending'),
  markDone: (userId: string) => set(userId, 'done'),
  async load(userId: string) {
    if (statuses.has(userId)) return;
    const stored = await AsyncStorage.getItem(key(userId));
    if (stored === 'done' || stored === 'pending') {
      statuses.set(userId, stored);
      emit();
      return;
    }
    const known = await askServer();
    // A sign-in that finished meanwhile already decided.
    if (statuses.has(userId)) return;
    if (known) await set(userId, known);
    else {
      // The server could not be asked: onboarding for now, asked again at the next start.
      statuses.set(userId, 'pending');
      emit();
    }
  },
  get: (userId: string): OnboardingStatus => statuses.get(userId) ?? 'unknown',
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useOnboardingStatus(userId: string | null): OnboardingStatus {
  useEffect(() => {
    if (userId) void onboardingStore.load(userId);
  }, [userId]);
  const read = () => (userId ? onboardingStore.get(userId) : 'unknown');
  return useSyncExternalStore(onboardingStore.subscribe, read, read);
}
