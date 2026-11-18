import type { Job, JobError, JobKind } from '@/api/contracts/jobs';
import { ulid } from '@/lib/ids';

/**
 * In-memory stand-in for the job table behind `GET v1/tenant/job/{id}`. A fixture job finishes after
 * `durationMs` of wall-clock time; nothing here survives an app restart (an unknown id reads as failed,
 * which is what the UI must handle for expired jobs anyway).
 */
type FixtureJob = {
  id: string;
  kind: JobKind;
  startedAt: number;
  durationMs: number;
  makeResult: () => unknown;
  error: JobError | null;
  cached?: unknown;
};

const jobs = new Map<string, FixtureJob>();

const DEFAULT_DURATION_MS = 4500;

/** Dev/test knobs: make the next started job fail, or change how long fixture jobs take. */
export const fixtureJobOptions: { failNext: JobError | null; durationMs: number } = {
  failNext: null,
  durationMs: DEFAULT_DURATION_MS,
};

/** Starts (or, for a known `id`, returns) a fixture job. Passing the request id as `id` makes the start idempotent. */
export function startFixtureJob<T>(kind: JobKind, makeResult: () => T, options: { id?: string; durationMs?: number } = {}): string {
  const id = options.id ?? `job_${ulid()}`;
  if (jobs.has(id)) return id;
  jobs.set(id, {
    id,
    kind,
    startedAt: Date.now(),
    durationMs: options.durationMs ?? fixtureJobOptions.durationMs,
    makeResult,
    error: fixtureJobOptions.failNext,
  });
  fixtureJobOptions.failNext = null;
  return id;
}

export function getFixtureJob<T>(id: string, kind: JobKind): Job<T> {
  const job = jobs.get(id);
  if (!job) {
    return { id, kind, status: 'failed', progress: null, result: null, error: { code: 'job_not_found', creditRefunded: true } };
  }
  const elapsed = Date.now() - job.startedAt;
  if (elapsed < job.durationMs) {
    return { id, kind: job.kind, status: elapsed < 400 ? 'queued' : 'running', progress: null, result: null, error: null };
  }
  if (job.error) return { id, kind: job.kind, status: 'failed', progress: null, result: null, error: job.error };
  if (job.cached === undefined) job.cached = job.makeResult();
  return { id, kind: job.kind, status: 'done', progress: null, result: job.cached as T, error: null };
}

export function resetFixtureJobs(): void {
  jobs.clear();
  fixtureJobOptions.failNext = null;
  fixtureJobOptions.durationMs = DEFAULT_DURATION_MS;
}
