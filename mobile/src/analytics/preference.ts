import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { setFirebaseCollection } from './firebase';

/**
 * Ayarlar › Gizlilik › "Ürün analitiği" (canvas 29d). Owner decision: product analytics (Firebase /
 * Google Analytics) is ON by default on the basis of legitimate interest, disclosed in the privacy
 * notice; the user can switch it off here at any time. Our own first-party analytics is not affected.
 *
 * The choice belongs to this phone (like the app language): it governs the analytics SDK installed on
 * it, is kept across sign-outs and is applied to the SDK on every start (`restoreProductAnalytics`) —
 * the SDK also persists it natively, so an opted-out phone sends nothing even before the app's JS runs.
 * There is no server-side settings sync for it (no generic settings endpoint exists).
 */
const KEY = 'droblet.productAnalytics';

let enabled: boolean | null = null;
let restoring: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function emit(next: boolean) {
  enabled = next;
  setFirebaseCollection(next);
  listeners.forEach((l) => l());
}

async function restore(): Promise<boolean> {
  let stored: string | null = null;
  try {
    stored = await AsyncStorage.getItem(KEY);
  } catch {
    // Storage unavailable: the default (on) applies for this session.
  }
  // A choice made while restoring wins.
  if (enabled === null) emit(stored !== '0');
  return enabled ?? true;
}

/** Reads the stored choice once per app start and applies it to Firebase. */
export function restoreProductAnalytics(): Promise<boolean> {
  restoring ??= restore();
  return restoring;
}

/** Switches product analytics on / off at once and remembers the choice on this phone. */
export async function setProductAnalyticsEnabled(next: boolean): Promise<void> {
  if (enabled === next) return;
  emit(next);
  try {
    await AsyncStorage.setItem(KEY, next ? '1' : '0');
  } catch {
    // The switch still applies for this session.
  }
}

function read(): boolean {
  return enabled ?? true;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current choice for the Ayarlar toggle (on until the stored one is read). */
export function useProductAnalyticsEnabled(): boolean {
  return useSyncExternalStore(subscribe, read, read);
}

/** Tests only. */
export function resetProductAnalyticsForTests(): void {
  enabled = null;
  restoring = null;
  listeners.clear();
}
