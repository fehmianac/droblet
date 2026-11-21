
import { track } from '@/analytics/track';
import { apiErrorCode, isCreditsExhausted, isPaywallError, teenStylistErrorCode } from '@/api/errors';
import { teenGate } from '@/features/teen/gate';
import { refreshTeenStylist } from '@/features/teen/store';

import { requirementsFlow } from '@/features/requirements/store';

import { creditSheetStore } from './creditSheetStore';
import { openPaywall } from '@/features/teen/TeenLocks';

/**
 * What the server's answer to an AI start request means for the user (README §9.1):
 * 403 `premium_required` → the paywall (05) · 402 `credits_exhausted` → the credit-pack sheet (05b).
 * The device-side gate (`useAiGate`) usually catches both first; the server is the authority, so
 * every start hook routes its error through here too. Returns true when the error was handled.
 */
export function routeAiStartError(error: unknown, feature: string): boolean {
  // A missing photo is a path, not a wall (canvas 11): the requirements sheet opens on the right action.
  const code = apiErrorCode(error);
  if (code === 'body_photo_required' || code === 'face_photo_required') {
    requirementsFlow.open({ action: feature === 'palette' ? 'palette' : 'tryOn' });
    return true;
  }
  // An approved teen's free-tier allowance (canvas 18 · 16u / 16v / 16w): calm, never the paywall.
  const teenCode = teenStylistErrorCode(error);
  if (teenCode) {
    refreshTeenStylist();
    const stop =
      teenCode === 'teen_stylist_daily_limit'
        ? 'stylistLimit'
        : teenCode === 'teen_stylist_weekly_limit'
          ? feature === 'suitcase'
            ? 'packLimit'
            : 'weekLimit'
          : 'unavailable';
    teenGate.apply(stop, () => undefined);
    return true;
  }
  if (isPaywallError(error)) {
    openPaywall({ from: feature });
    return true;
  }
  if (isCreditsExhausted(error)) {
    track('credits_exhausted', { feature });
    creditSheetStore.open('exhausted');
    return true;
  }
  return false;
}
