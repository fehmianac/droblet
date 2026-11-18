import { router } from 'expo-router';

import { track } from '@/analytics/track';
import { isCreditsExhausted, isPaywallError } from '@/api/errors';

import { creditSheetStore } from './creditSheetStore';

/**
 * What the server's answer to an AI start request means for the user (README §9.1):
 * 403 `premium_required` → the paywall (05) · 402 `credits_exhausted` → the credit-pack sheet (05b).
 * The device-side gate (`useAiGate`) usually catches both first; the server is the authority, so
 * every start hook routes its error through here too. Returns true when the error was handled.
 */
export function routeAiStartError(error: unknown, feature: string): boolean {
  if (isPaywallError(error)) {
    router.push({ pathname: '/paywall', params: { from: feature } });
    return true;
  }
  if (isCreditsExhausted(error)) {
    track('credits_exhausted', { feature });
    creditSheetStore.open('exhausted');
    return true;
  }
  return false;
}
