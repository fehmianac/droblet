import { router } from 'expo-router';

import { track } from '@/analytics/track';
import { onboardingStore } from '@/auth/onboarding';
import { pushAskPending } from '@/notify/push';

/**
 * The end of onboarding (UX turu 1 · F, owner decision): onboarding ends on 06 Bugün, never on 05 Üyelik — it is
 * marked done here and the guards open Bugün. 05 opens once by itself after the first try-on result
 * (`useFirstTryOnPaywall`).
 */
export function finishOnboarding(userId: string | null): void {
  if (!userId) return;
  track('signup_step', { step: 'done' });
  void onboardingStore.markDone(userId);
}

/**
 * After 04b İlk 5 parça: 04d Bildirim izni (canvas 19) while the OS can still show its prompt and this
 * install was never asked; otherwise (granted, refused for good, web, asked before) straight on.
 */
export async function continueAfterFirstItems(userId: string | null): Promise<void> {
  if (await pushAskPending()) router.push('/push-permission');
  else finishOnboarding(userId);
}
