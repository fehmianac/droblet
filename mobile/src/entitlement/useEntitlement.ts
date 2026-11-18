import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type { Entitlement } from '@/api/contracts';
import { queryKeys } from '@/sync/queryKeys';

/** Server is the only source of tier and credits — no package logic or fixed numbers in the app. */
export function useEntitlement() {
  return useQuery({
    queryKey: queryKeys.entitlement,
    queryFn: () => apiRequest<Entitlement>('v1/tenant/entitlement'),
  });
}
