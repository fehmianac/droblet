import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import { ApiError } from '@/api/errors';
import { toEntitlement, type EntitlementWire } from '@/api/wire/core';
import { queryKeys } from '@/sync/queryKeys';

export const SELF_PREMIUM_DISABLED = 'self_premium_disabled';

/**
 * Temporary self-serve premium (owner decision 2026-11-19, until store purchases are live):
 * `POST` / `DELETE v1/tenant/entitlement/self-premium`. Online and interactive (not queued): the caller shows
 * the outcome. On success the answer is the new entitlement — written to the cache at once, and every
 * entitlement-derived query (credits, recognition allowance, paywall) is refetched so premium features
 * and credits follow immediately.
 */
export function useSelfPremium() {
  const client = useQueryClient();
  return useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: (on: boolean) =>
      apiRequest<EntitlementWire>('v1/tenant/entitlement/self-premium', { method: on ? 'POST' : 'DELETE' }),
    onSuccess: (wire) => {
      client.setQueryData(queryKeys.entitlement, toEntitlement(wire));
      // ['tenant', 'entitlement', …] covers the AI credit and recognition queries too.
      void client.invalidateQueries({ queryKey: queryKeys.entitlement });
    },
    onError: (error) => {
      // Switched off meanwhile (or a store subscription arrived): refresh so the section disappears.
      if (error instanceof ApiError && (error.status === 403 || error.status === 409)) void client.invalidateQueries({ queryKey: queryKeys.entitlement });
    },
  });
}

export function isSelfPremiumDisabled(error: unknown): boolean {
  return error instanceof ApiError && error.code === SELF_PREMIUM_DISABLED;
}
