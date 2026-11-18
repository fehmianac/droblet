import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

/**
 * Per-user onboarding progress on this device. Register → 'pending' (03 → 04 → 04b → 05);
 * email login → 'done' (BRIEF 02: successful login goes to 06). Social sign-in may be a new
 * account, so it starts 'pending'; 03 prefills from the server profile when one exists.
 */
export type OnboardingStatus = 'unknown' | 'pending' | 'done';

const key = (userId: string) => `droblet.onboarding.${userId}`;
const statuses = new Map<string, OnboardingStatus>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

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
    statuses.set(userId, stored === 'done' ? 'done' : 'pending');
    emit();
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
