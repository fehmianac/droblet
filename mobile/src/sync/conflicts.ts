import { useSyncExternalStore } from 'react';

/**
 * Conflicts raised by queued writes (409 changed elsewhere / 404 deleted elsewhere).
 * The conflicting write is set aside — the rest of the queue continues — and the user decides
 * (MOBILE_ENGINEER §Çakışma). Never overwrite silently.
 */
export type Conflict = {
  id: string;
  kind: 'changed' | 'deleted';
  /** Re-sends the user's version on top of the server's version (a user decision). */
  keepMine?: () => void;
  /** Accepts the server's version locally. */
  keepTheirs: () => void;
};

let conflicts: Conflict[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const conflictStore = {
  push(conflict: Conflict) {
    conflicts = [...conflicts, conflict];
    emit();
  },
  resolve(id: string) {
    conflicts = conflicts.filter((c) => c.id !== id);
    emit();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get: () => conflicts,
};

export function useConflicts(): Conflict[] {
  return useSyncExternalStore(conflictStore.subscribe, conflictStore.get, conflictStore.get);
}
