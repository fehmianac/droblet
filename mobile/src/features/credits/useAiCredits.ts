import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';

import { apiRequest } from '@/api/client';
import type { Entitlement } from '@/api/contracts';
import { fromSource } from '@/api/dataSource';
import { clone, fixtureDb } from '@/fixtures/db';

/** Separate from `queryKeys.entitlement` (the paywall's live query) so fixture data never lands in that cache entry. */
export const aiCreditsKey = ['tenant', 'entitlement', 'ai-credits'] as const;

export type AiCredits = {
  isLoading: boolean;
  isMember: boolean;
  /** Null while unknown — never show a guessed number. */
  remaining: number | null;
  monthlyAllowance: number | null;
  /** True when a try-on costing `cost` credits can start. */
  canAfford: (cost: number) => boolean;
  refresh: () => void;
};

/**
 * AI image credits ("1 kredi · kalan 11"). The server is the only source; the app never keeps its
 * own counter (README §9.1). Fixture-backed together with the AI jobs until E6 is live.
 */
export function useAiCredits(): AiCredits {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: aiCreditsKey,
    queryFn: () =>
      fromSource<Entitlement>(
        'jobs',
        () => clone(fixtureDb.entitlement),
        () => apiRequest<Entitlement>('v1/tenant/entitlement'),
      ),
  });
  const remaining = query.data?.credits.remaining ?? null;
  return {
    isLoading: query.isPending,
    isMember: query.data?.tier === 'member',
    remaining,
    monthlyAllowance: query.data?.credits.monthlyAllowance ?? null,
    canAfford: (cost) => remaining !== null && remaining >= cost,
    refresh: () => void client.invalidateQueries({ queryKey: aiCreditsKey }),
  };
}

/**
 * Where "Kredi yükle" / a locked AI feature leads.
 * Non-members → 05 paywall. Members out of credits → the 05b extra-credit sheet, which is owned by the
 * store/profile slice; until it lands this opens the subscription screen.
 */
export function openCreditTopUp(isMember: boolean): void {
  router.push(isMember ? '/subscription' : '/paywall');
}
