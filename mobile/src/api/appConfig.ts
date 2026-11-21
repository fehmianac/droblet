import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/sync/queryKeys';

import { apiRequest } from './client';
import { toAppConfig, type ConfigWire } from './wire/core';

/** `GET v1/config` — anonymous app configuration (open segments, teen mode); cached for an hour. */
export function useAppConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    staleTime: 60 * 60_000,
    queryFn: async () => toAppConfig(await apiRequest<ConfigWire>('v1/config')),
  });
}
