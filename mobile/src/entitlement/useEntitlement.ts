import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import { toEntitlement, type EntitlementWire } from '@/api/wire/core';
import { queryKeys } from '@/sync/queryKeys';

/** Server is the only source of tier and credits — no package logic or fixed numbers in the app. */
export function useEntitlement() {
  return useQuery({
    queryKey: queryKeys.entitlement,
    queryFn: async () => toEntitlement(await apiRequest<EntitlementWire>('v1/tenant/entitlement')),
  });
}
