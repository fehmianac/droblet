import { useSyncExternalStore } from 'react';

import type { TryOnTarget } from '@/api/contracts/tryon';
import { cachedTryOnImageId } from '@/api/wire/tryon';

/**
 * Try-on jobs started in this session, by target: lets a screen that is not the try-on screen (14b's hero)
 * show "Hazırlanıyor…" while the image of its target is generated, and swap to the image when it is done.
 * In memory only; the job itself is polled through `useTryOnJob` (shared query, no second poll).
 */
type Run = { jobId: string };

let runs: Record<string, Run> = {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const targetKey = (target: TryOnTarget) => `${target.kind}:${target.id}`;

export const tryOnRuns = {
  /** A real job started for `target` (an already existing image's pseudo id is not a run). */
  record(target: TryOnTarget, jobId: string) {
    if (cachedTryOnImageId(jobId)) return;
    runs = { ...runs, [targetKey(target)]: { jobId } };
    emit();
  },
  /** The run of `target` ended (done, failed or timed out). */
  clear(target: TryOnTarget, jobId?: string) {
    const key = targetKey(target);
    if (!runs[key] || (jobId && runs[key].jobId !== jobId)) return;
    const next = { ...runs };
    delete next[key];
    runs = next;
    emit();
  },
  get(target: TryOnTarget): string | null {
    return runs[targetKey(target)]?.jobId ?? null;
  },
  reset() {
    runs = {};
    emit();
  },
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The job id of the try-on being generated for `target` in this session, or null. */
export function useTryOnRun(target: TryOnTarget | null): string | null {
  return useSyncExternalStore(subscribe, () => (target ? tryOnRuns.get(target) : null));
}
