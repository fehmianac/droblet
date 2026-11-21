import { useAppConfig } from '@/api/appConfig';
import type { AppSegment } from '@/api/contracts';

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

export { useAppConfig };

/** Server configuration: which segments users may pick (`segments.available`; absent = women only, phase 1). */
export function useAvailableSegments(): AvailableSegments {
  const config = useAppConfig();
  const segments = config.data?.availableSegments ?? ['women'];
  const settled = config.data !== undefined || config.isError || config.failureCount > 0 || config.fetchStatus === 'paused';
  return { segments, choice: showSegmentChoice(segments), loading: !settled };
}
