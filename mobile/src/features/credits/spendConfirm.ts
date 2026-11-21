import AsyncStorage from '@react-native-async-storage/async-storage';

import { sessionStore } from '@/auth/session';

import { useAiCredits } from './useAiCredits';

/**
 * When "Üzerimde gör" asks before spending (owner decision, canvas n_ux1 C). The button already carries the cost
 * ("Üzerimde gör · 1 kredi"), so 07b Kredi onayı opens only:
 * - on the user's first try-on ever (the "tried" flag is per user and stays on this phone — nothing is sent);
 * - when the balance after this spend would be at most `LOW_BALANCE_AFTER`;
 * - for an action costing more than one credit (07 hafta "· 7 kredi");
 * - and whenever the sheet has something else to say: not a member, balance unknown or not enough ("Üye ol" /
 *   "Kredi yükle" — never a silent failure).
 * Otherwise the try-on starts at once. The server still reserves and refunds credits as before.
 */
export const LOW_BALANCE_AFTER = 2;

export type SpendCheck = {
  cost: number;
  remaining: number | null;
  isMember: boolean;
  /** A try-on was started before by this user on this phone. */
  triedBefore: boolean;
};

export function needsSpendConfirm({ cost, remaining, isMember, triedBefore }: SpendCheck): boolean {
  if (cost > 1) return true;
  if (!triedBefore) return true;
  if (!isMember || remaining === null || remaining < cost) return true;
  return remaining - cost <= LOW_BALANCE_AFTER;
}

export const triedOnKey = (userId: string) => `droblet.tryOnStarted.${userId}`;

function signedInUserId(): string | null {
  const session = sessionStore.getState();
  return session.status === 'signedIn' ? session.user.id : null;
}

export async function hasTriedOn(userId: string | null = signedInUserId()): Promise<boolean> {
  if (!userId) return false;
  try {
    return (await AsyncStorage.getItem(triedOnKey(userId))) === 'yes';
  } catch {
    // Without storage the confirmation simply shows; nothing is lost.
    return false;
  }
}

/** Called when a try-on was accepted by the server (`useStartTryOn`, the week plan). */
export async function markTriedOn(userId: string | null = signedInUserId()): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(triedOnKey(userId), 'yes');
  } catch {
    // The confirmation shows once more; nothing is lost.
  }
}

export type SpendSteps = {
  /** Opens 07b Kredi onayı (its "kullan" then starts the try-on). */
  confirm: () => void;
  /** Starts the try-on without the sheet. */
  start: () => void;
};

/**
 * `spend(cost, { confirm, start })` — call it where the screen used to open the credit confirmation (after the
 * requirements and consent): it opens the sheet only when `needsSpendConfirm` says so, else starts at once.
 */
export function useSpendConfirm(): (cost: number, steps: SpendSteps) => void {
  const credits = useAiCredits();
  return (cost, { confirm, start }) => {
    void hasTriedOn().then((triedBefore) => {
      if (needsSpendConfirm({ cost, remaining: credits.remaining, isMember: credits.isMember, triedBefore })) confirm();
      else start();
    });
  };
}
