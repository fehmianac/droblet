import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type { AppSegment } from '@/api/contracts';
import { toAppConfig, type ConfigWire } from '@/api/wire/core';
import { queryKeys } from '@/sync/queryKeys';

import { showSegmentChoice } from './catalog';

export type AvailableSegments = {
  segments: AppSegment[];
  /** More than one segment is open: "Reyon" is asked (03a) and changeable (Profil › Stil profili). */
  choice: boolean;
  /**
   * Still waiting for the first answer. A failed or paused request (offline) does not wait for retries:
   * it counts as women only, so nothing is ever blocked on this setting.
   */
  loading: boolean;
};

/** `GET v1/config` — anonymous app configuration; cached for an hour. */
export function useAppConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    staleTime: 60 * 60_000,
    queryFn: async () => toAppConfig(await apiRequest<ConfigWire>('v1/config')),
  });
}

/** Server configuration: which segments users may pick (`segments.available`; absent = women only, phase 1). */
export function useAvailableSegments(): AvailableSegments {
  const config = useAppConfig();
  const segments = config.data?.availableSegments ?? ['women'];
  const settled = config.data !== undefined || config.isError || config.failureCount > 0 || config.fetchStatus === 'paused';
  return { segments, choice: showSegmentChoice(segments), loading: !settled };
}
