import { useSyncExternalStore } from 'react';

import { ApiError } from '@/api/errors';
import { track } from '@/analytics/track';

/**
 * 05b Ek kredi paketi — opened from anywhere: when a write comes back `credits_exhausted`
 * (also from the queue, long after the tap) and from Profil "Kredi yükle".
 */
export type CreditSheetReason = 'exhausted' | 'topUp';

let reason: CreditSheetReason | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const creditSheetStore = {
  open(next: CreditSheetReason) {
    reason = next;
    emit();
  },
  close() {
    reason = null;
    emit();
  },
  get: () => reason,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useCreditSheetReason(): CreditSheetReason | null {
  return useSyncExternalStore(creditSheetStore.subscribe, creditSheetStore.get, creditSheetStore.get);
}

/** Server codes meaning "this month's AI image credits are used up". */
const EXHAUSTED_CODES = ['credits_exhausted', 'monthly_limit_reached'];

export function isCreditsExhausted(error: unknown): boolean {
  return error instanceof ApiError && error.code !== null && EXHAUSTED_CODES.includes(error.code);
}

/** Opens 05b when an AI write failed because the credits ran out. Returns whether it did. */
export function openCreditSheetIfExhausted(error: unknown, feature: string): boolean {
  if (!isCreditsExhausted(error)) return false;
  track('credits_exhausted', { feature });
  creditSheetStore.open('exhausted');
  return true;
}
