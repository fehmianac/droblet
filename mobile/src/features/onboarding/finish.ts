import { router } from 'expo-router';

import { onboardingStore } from '@/auth/onboarding';
import { openPaywall } from '@/features/teen/TeenLocks';
import { currentTeenRules } from '@/features/teen/store';
import { pushAskPending } from '@/notify/push';

/**
 * The end of onboarding: 05 Üyelik (closing it marks onboarding done), or — canvas 18: a teen never sees
 * the paywall — onboarding is marked done here and the guards open Bugün.
 */
export function finishOnboarding(userId: string | null): void {
  if (currentTeenRules().hide.paywall) {
    if (userId) void onboardingStore.markDone(userId);
    return;
  }
  openPaywall({ from: 'onboarding' });
}

/**
 * After 04b İlk 5 parça: 04d Bildirim izni (canvas 19) while the OS can still show its prompt and this
 * install was never asked; otherwise (granted, refused for good, web, asked before) straight on.
 */
export async function continueAfterFirstItems(userId: string | null): Promise<void> {
  if (await pushAskPending()) router.push('/push-permission');
  else finishOnboarding(userId);
}
