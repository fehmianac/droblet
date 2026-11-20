import type { Job, JobKind } from '@/api/contracts/jobs';
import type { TryOnTargetKind } from '@/api/contracts/tryon';
import { cachedTryOnImageId } from '@/api/wire/tryon';

import { track } from './track';

/**
 * Analytics of the AI jobs, reported from the one polling hook (`api/jobs.ts`) so every screen that
 * waits on a job reports its outcome the same way — once per job, however many screens poll it.
 *
 * Try-on: the start (`useStartTryOn`) records the picture path and target per job id; the outcome event
 * repeats them. A pseudo job id of an image that already existed (`cachedTryOnJobId`) costs nothing and is
 * complete at once.
 */
export type TryOnPath = 'body' | 'face';

/** = TRY_ON_CREDIT_COST in features/tryon/api.ts (kept here so analytics does not import the feature). */
const TRY_ON_CREDIT_COST = 1;

type TryOnStart = { path: TryOnPath; target: TryOnTargetKind };

const tryOnStarts = new Map<string, TryOnStart>();
const reported = new Set<string>();

/** Bounded memory: job ids older than this many are forgotten. */
const MAX_REMEMBERED = 200;

function remember(id: string) {
  reported.add(id);
  if (reported.size > MAX_REMEMBERED) {
    const oldest = reported.values().next().value;
    if (oldest !== undefined) reported.delete(oldest);
  }
}

export function trackTryOnStarted(jobId: string, target: TryOnTargetKind, path: TryOnPath): void {
  const cached = cachedTryOnImageId(jobId) !== null;
  const params = { path, target, cached, creditCost: cached ? 0 : TRY_ON_CREDIT_COST };
  track('tryon_start', params);
  if (cached) {
    remember(jobId);
    track('tryon_complete', params);
    return;
  }
  tryOnStarts.set(jobId, { path, target });
  if (tryOnStarts.size > MAX_REMEMBERED) {
    const oldest = tryOnStarts.keys().next().value;
    if (oldest !== undefined) tryOnStarts.delete(oldest);
  }
}

function countOf(result: unknown, key: string): number | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const value = (result as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.length : undefined;
}

/** Called with every polled job; reports a settled one once. */
export function reportJobSettled(kind: JobKind, id: string, job: Pick<Job<unknown>, 'status' | 'result' | 'error'> | undefined): void {
  if (!job || (job.status !== 'done' && job.status !== 'failed') || reported.has(id)) return;
  remember(id);
  const done = job.status === 'done';
  switch (kind) {
    case 'tryon': {
      const start = tryOnStarts.get(id);
      tryOnStarts.delete(id);
      const base = { path: start?.path ?? null, target: start?.target ?? null };
      if (done) track('tryon_complete', { ...base, cached: false, creditCost: TRY_ON_CREDIT_COST });
      else track('tryon_failed', { ...base, errorCode: job.error?.code ?? null, creditRefunded: job.error?.creditRefunded ?? false });
      return;
    }
    case 'stylist-outfit':
      if (done) track('outfit_suggested', { source: 'stylist', count: countOf(job.result, 'suggestions') ?? null });
      return;
    case 'stylist-complete':
      if (done) track('outfit_suggested', { source: 'complete' });
      return;
    case 'stylist-week':
      if (done) track('week_planned', { count: countOf(job.result, 'days') ?? null });
      return;
    case 'trip-pack':
      if (done) track('trip_packed', { count: countOf(job.result, 'items') ?? null });
      return;
    default:
      return;
  }
}

/** Tests only. */
export function resetJobEventsForTests(): void {
  tryOnStarts.clear();
  reported.clear();
}
