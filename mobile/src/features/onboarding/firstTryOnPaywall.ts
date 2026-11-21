import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused } from 'expo-router';
import { useEffect } from 'react';

import { useSession } from '@/auth/session';
import { useAiCredits } from '@/features/credits/useAiCredits';
import { openPaywall } from '@/features/teen/TeenLocks';
import { currentTeenRules } from '@/features/teen/store';

/**
 * UX turu 1 · F (owner decision): 05 Üyelik opens by itself once, right after the first try-on result has been revealed,
 * and only for a non-member (never for a teen: canvas 18 hides the paywall). The "shown" flag is per user and stays
 * on this phone; nothing is sent anywhere.
 */
export const firstTryOnPaywallKey = (userId: string) => `droblet.firstTryOnPaywall.${userId}`;

/** A beat after the curtain opens, so the result is seen before the paywall slides over it. */
export const FIRST_TRY_ON_PAYWALL_DELAY_MS = 1200;

async function wasShown(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(firstTryOnPaywallKey(userId))) !== null;
  } catch {
    // Without storage it is better to stay quiet than to open the paywall again and again.
    return true;
  }
}

async function markShown(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(firstTryOnPaywallKey(userId), new Date().toISOString());
  } catch {
    // Nothing to do: at worst the paywall opens once more after another first result.
  }
}

/**
 * Call on the try-on result screen with whether the result is revealed (the curtain has opened on a finished job).
 * Leaving or blurring the screen before the beat cancels it; the flag is written only when the paywall opens.
 */
export function useFirstTryOnPaywall(revealed: boolean): void {
  const session = useSession();
  const userId = session.status === 'signedIn' ? session.user.id : null;
  const credits = useAiCredits();
  // Membership unknown (still loading, offline): never guess — wait for the entitlement.
  const nonMember = credits.isLoading ? null : !credits.isMember;
  const focused = useIsFocused();

  useEffect(() => {
    if (!revealed || !focused || !userId || nonMember !== true || currentTeenRules().hide.paywall) return;
    let alive = true;
    const timer = setTimeout(() => {
      void (async () => {
        if ((await wasShown(userId)) || !alive) return;
        openPaywall({ from: 'firstTryOn' });
        await markShown(userId);
      })();
    }, FIRST_TRY_ON_PAYWALL_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [revealed, focused, userId, nonMember]);
}
