import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';

import { apiRequest } from '@/api/client';
import type { Entitlement } from '@/api/contracts';
import { fromSource } from '@/api/dataSource';
import { ApiError } from '@/api/errors';
import { clone, fixtureDb } from '@/fixtures/db';

/**
 * AI recognition of garment photos (12, 13) — owner decision 2026-11-18: free for non-members up to
 * a server-configured limit, unlimited for members. The server is the only source of the numbers
 * (`GET v1/tenant/entitlement` → `itemRecognition`) and the authority: starting item processing
 * answers 402 `item_recognition_limit_reached` when the quota is used up. The app then shows the
 * paywall and ALWAYS keeps "Elle gir": the piece can be saved without AI through form 12c.
 */
export const ITEM_RECOGNITION_LIMIT_CODE = 'item_recognition_limit_reached';

/** Separate from `queryKeys.entitlement` (the paywall's live query) so fixture data never lands in that cache entry. */
export const itemRecognitionKey = ['tenant', 'entitlement', 'item-recognition'] as const;

/**
 * Recognitions the user may still start. `null` = no client-side limit: unlimited (member, `limit: null`)
 * or not known yet (offline, older server) — the request goes out and the server decides.
 */
export function recognitionRemaining(entitlement: Pick<Entitlement, 'itemRecognition'> | undefined): number | null {
  const quota = entitlement?.itemRecognition;
  if (!quota || quota.limit === null) return null;
  if (quota.limit <= 0) return 0;
  return Math.max(0, quota.remaining ?? quota.limit - quota.used);
}

export function isRecognitionLimitReached(error: unknown): boolean {
  return error instanceof ApiError && error.code === ITEM_RECOGNITION_LIMIT_CODE;
}

/** Bulk add: the photos that fit the remaining quota are processed, the rest are reported as skipped. */
export function fitToRecognitionQuota<T>(photos: T[], remaining: number | null): { accepted: T[]; skipped: number } {
  if (remaining === null || photos.length <= remaining) return { accepted: photos, skipped: 0 };
  const accepted = photos.slice(0, Math.max(0, remaining));
  return { accepted, skipped: photos.length - accepted.length };
}

/** The paywall for the recognition quota; the screen underneath keeps its "Elle gir" action. */
export function openRecognitionPaywall(): void {
  router.push({ pathname: '/paywall', params: { from: 'item_recognition' } });
}

export function useItemRecognition() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: itemRecognitionKey,
    queryFn: () =>
      fromSource<Entitlement>(
        'wardrobe',
        () => clone(fixtureDb.entitlement),
        () => apiRequest<Entitlement>('v1/tenant/entitlement'),
      ),
  });
  const remaining = recognitionRemaining(query.data);
  return {
    /** Null = unlimited or unknown. */
    remaining,
    /** True only when the server said nothing is left; unknown never blocks. */
    exhausted: remaining !== null && remaining <= 0,
    refresh: () => client.invalidateQueries({ queryKey: itemRecognitionKey }),
  };
}
