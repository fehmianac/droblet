
import { track } from '@/analytics/track';
import type { Entitlement } from '@/api/contracts';
import { useEntitlement } from '@/entitlement/useEntitlement';

import { creditSheetStore } from './creditSheetStore';
import { openPaywall } from '@/features/teen/TeenLocks';

export type AiGateDecision = 'allow' | 'paywall' | 'credits';

/**
 * What happens when the user touches an AI feature (README §9.1):
 * not a member → paywall · member with no credits left (image features only) → 05b sheet · else go.
 * While the entitlement is unknown (offline, first load) the action proceeds — the server is the
 * authority and answers with an error code the write handlers understand.
 */
export function decideAiGate(entitlement: Entitlement | undefined, costsCredit: boolean): AiGateDecision {
  if (!entitlement) return 'allow';
  if (entitlement.tier !== 'member') return 'paywall';
  if (costsCredit && entitlement.credits.remaining <= 0) return 'credits';
  return 'allow';
}

/** `gate(feature, action)` runs `action` only when the user may use the AI feature; returns whether it ran. */
export function useAiGate() {
  const entitlement = useEntitlement();
  return (feature: string, action: () => void, options: { costsCredit?: boolean } = {}): boolean => {
    const decision = decideAiGate(entitlement.data, options.costsCredit ?? true);
    if (decision === 'paywall') {
      openPaywall({ from: feature });
      return false;
    }
    if (decision === 'credits') {
      track('credits_exhausted', { feature });
      creditSheetStore.open('exhausted');
      return false;
    }
    action();
    return true;
  };
}
