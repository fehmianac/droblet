import { useSyncExternalStore } from 'react';

import { DEFAULT_TEEN_CONFIG, type TeenConfig, type TeenState } from '@/api/contracts/teen';
import { sessionStore, useSession } from '@/auth/session';

import { teenRules, type TeenRules } from './rules';

/**
 * The signed-in account's age band and teen status, and the server's teen configuration — as `TeenHost` last read
 * them (`GET v1/tenant/teen`, `GET v1/config`). A module store like `segmentStore`: low-level pieces (analytics, the
 * share host, route guards) read it without a QueryClient. Empty until the first answer: the session's remembered band
 * covers that gap.
 */
type Snapshot = { state: TeenState | null; config: TeenConfig };

let snapshot: Snapshot = { state: null, config: DEFAULT_TEEN_CONFIG };
const listeners = new Set<() => void>();
const refreshListeners = new Set<() => void>();

function emit(next: Snapshot) {
  snapshot = next;
  listeners.forEach((l) => l());
}

export const teenStore = {
  get: (): Snapshot => snapshot,
  setState(state: TeenState | null) {
    if (JSON.stringify(state) === JSON.stringify(snapshot.state)) return;
    emit({ ...snapshot, state });
  },
  setConfig(config: TeenConfig) {
    if (JSON.stringify(config) === JSON.stringify(snapshot.config)) return;
    emit({ ...snapshot, config });
  },
  /** Asks `TeenHost` to read `GET v1/tenant/teen` again (after a stylist start: the allowance moved). */
  requestRefresh() {
    refreshListeners.forEach((l) => l());
  },
  onRefresh(listener: () => void) {
    refreshListeners.add(listener);
    return () => {
      refreshListeners.delete(listener);
    };
  },
  /** Sign-out / another account / tests. */
  reset() {
    emit({ state: null, config: DEFAULT_TEEN_CONFIG });
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useTeenSnapshot(): Snapshot {
  return useSyncExternalStore(teenStore.subscribe, teenStore.get, teenStore.get);
}

/** THE teen hook: what is hidden, locked and allowed for the signed-in account (canvas 18). Adults get everything. */
export function useTeenRules(): TeenRules {
  const { state, config } = useTeenSnapshot();
  const session = useSession();
  if (session.status !== 'signedIn') return teenRules(null, config, null);
  return teenRules(state, config, session.user.ageBand ?? null);
}

/** The account's age band (`unknown` before the server said). */
export function useAgeBand(): TeenRules['band'] {
  return useTeenRules().band;
}

/** Outside React (hosts, navigation helpers): the rules right now. */
export function currentTeenRules(): TeenRules {
  const session = sessionStore.getState();
  if (session.status !== 'signedIn') return teenRules(null, snapshot.config, null);
  return teenRules(snapshot.state, snapshot.config, session.user.ageBand ?? null);
}

/** After a stylist start or a teen allowance answer: the approved teen's allowance is read again (no-op for adults). */
export function refreshTeenStylist(): void {
  if (currentTeenRules().stylist) teenStore.requestRefresh();
}
