import { useSyncExternalStore } from 'react';

import type { AppSegment } from '@/api/contracts';

/**
 * The signed-in user's segment ("reyon"), as the screens and placeholders read it. `SegmentHost` keeps it
 * in step with the style profile; onboarding 03a sets it as soon as the user picks one (before the profile
 * is saved), so 03 already shows that segment's tags. A module store, not a query: low-level pieces such as
 * the `Silhouette` read it without a QueryClient. Women until something says otherwise (phase 1 default).
 */
let current: AppSegment = 'women';
const listeners = new Set<() => void>();

export const segmentStore = {
  get: (): AppSegment => current,
  set(segment: AppSegment) {
    if (segment === current) return;
    current = segment;
    listeners.forEach((l) => l());
  },
  /** Sign-out / another account / tests. */
  reset() {
    segmentStore.set('women');
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** The segment that drives copy, body types, style tags, placeholders, subcategories and catalogue queries. */
export function useSegment(): AppSegment {
  return useSyncExternalStore(segmentStore.subscribe, segmentStore.get, segmentStore.get);
}
