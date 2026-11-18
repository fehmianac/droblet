import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import type { HandleAvailability } from '@/api/contracts/account';

/** What the user types → what the server stores: no `@`, no spaces, lower case. */
export function normaliseHandle(text: string): string {
  return text.trim().replace(/^@/, '').toLowerCase();
}

export type HandleStatusKind = 'idle' | 'current' | 'checking' | 'available' | 'taken' | 'reserved' | 'invalid' | 'unknown';

/**
 * The line under the @handle field and whether "Kaydet" is allowed. A failed save (409 / 422 / 400)
 * wins over an older "available" answer; a failed check does not block saving (the server decides).
 */
export function handleStatus(input: {
  value: string;
  current: string | null;
  checked: string;
  availability: HandleAvailability | undefined;
  checking: boolean;
  failed: boolean;
  saveError: string | null;
}): { kind: HandleStatusKind; canSave: boolean } {
  const { value, current, checked, availability, checking, failed, saveError } = input;
  if (value === '') return { kind: 'idle', canSave: false };
  if (current !== null && value === current) return { kind: 'current', canSave: false };
  if (saveError === 'handle_taken') return { kind: 'taken', canSave: false };
  if (saveError === 'handle_reserved') return { kind: 'reserved', canSave: false };
  if (saveError === 'handle_invalid' || saveError === 'validation_failed') return { kind: 'invalid', canSave: false };
  if (checking || checked !== value) return { kind: 'checking', canSave: false };
  if (failed || !availability) return { kind: 'unknown', canSave: true };
  if (availability.available) return { kind: 'available', canSave: true };
  return { kind: availability.code === 'handle_taken' ? 'taken' : availability.code === 'handle_reserved' ? 'reserved' : 'invalid', canSave: false };
}

/** One-time "Profilini tamamla" card after onboarding (per user, on this device). */
const nudgeKey = (userId: string) => `droblet.profileNudge.${userId}`;

export function useProfileNudge(userId: string | null, hasHandle: boolean | null): { visible: boolean; dismiss: () => void } {
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void AsyncStorage.getItem(nudgeKey(userId))
      .then((v) => alive && setDismissed(v === 'done'))
      .catch(() => alive && setDismissed(false));
    return () => {
      alive = false;
    };
  }, [userId]);

  const dismiss = () => {
    setDismissed(true);
    if (userId) void AsyncStorage.setItem(nudgeKey(userId), 'done').catch(() => undefined);
  };
  return { visible: hasHandle === false && dismissed === false, dismiss };
}
