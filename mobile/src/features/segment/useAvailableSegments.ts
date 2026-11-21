import type { AppSegment } from '@/api/contracts';
import { useEntitlement } from '@/entitlement/useEntitlement';

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

/** Server configuration: which segments users may pick (entitlement `availableSegments`, absent = women only). */
export function useAvailableSegments(): AvailableSegments {
  const entitlement = useEntitlement();
  const segments = entitlement.data?.availableSegments ?? ['women'];
  const settled = entitlement.data !== undefined || entitlement.isError || entitlement.failureCount > 0 || entitlement.fetchStatus === 'paused';
  return { segments, choice: showSegmentChoice(segments), loading: !settled };
}
