import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { getFixtureJob } from '@/fixtures/jobs';

import { apiRequest } from './client';
import type { Job, JobKind } from './contracts/jobs';
import { fromSource } from './dataSource';
import { toJob, type JobWire } from './wire/core';

/** Poll bounds: never sooner than 500 ms, never later than 3 s (a 26 s job used to be noticed at ~35 s with the old 1-2-4-8-10 s back-off). */
export const POLL_MIN_MS = 500;
export const POLL_MAX_MS = 3000;

/**
 * Next poll of a running job, `elapsedMs` after the first poll: every 750 ms for the first 3 s (text jobs often finish
 * there), then every 1.5 s, and every 3 s after 15 s. A server hint (`retryAfterMs`, from the typical duration of the job
 * kind) wins, clamped to 500 ms … 3 s. Polling pauses while the app is in the background (TanStack focus manager,
 * `wireNetworkAndFocus`) and refetches on return.
 */
export function jobPollInterval(elapsedMs: number, hintMs?: number | null): number {
  if (typeof hintMs === 'number' && Number.isFinite(hintMs) && hintMs > 0) {
    return Math.min(Math.max(Math.round(hintMs), POLL_MIN_MS), POLL_MAX_MS);
  }
  const elapsed = Math.max(0, elapsedMs);
  if (elapsed < 3000) return 750;
  if (elapsed < 15_000) return 1500;
  return POLL_MAX_MS;
}

/** When each job query was first scheduled (the fast start of the schedule is measured from here). */
const pollStartedAt = new Map<string, number>();

function sincePollStart(key: string, now = Date.now()): number {
  const start = pollStartedAt.get(key);
  if (start === undefined) {
    pollStartedAt.set(key, now);
    return 0;
  }
  return now - start;
}

export function isJobSettled(job: Pick<Job<unknown>, 'status'> | undefined): boolean {
  return job?.status === 'done' || job?.status === 'failed';
}

export const jobQueryKey = (id: string) => ['tenant', 'job', id] as const;

/** After this long without a result the UI offers "Tekrar dene" (the job itself may still finish on the server). */
export const JOB_TIMEOUT_MS = 90_000;

export type JobView<T> = {
  job: Job<T> | undefined;
  /** Queued / running and not timed out. */
  isWorking: boolean;
  isDone: boolean;
  /** Failed on the server, the poll itself failed, or the wait timed out. */
  isFailed: boolean;
  timedOut: boolean;
  result: T | null;
  /** The server returned the reserved credit. A timeout delivers nothing, so it reads as refunded too. */
  creditRefunded: boolean;
  errorCode: string | null;
  /** The poll's own error (network, or a `mapResult` that threw, e.g. a refused draft); null otherwise. */
  error?: unknown;
  /** Poll again now (also clears a timeout). */
  refetch: () => void;
};

type Options<T> = {
  /** Pass the screen's focus state: polling stops while the screen is not focused. Default true. */
  enabled?: boolean;
  timeoutMs?: number;
  /**
   * Converts the wire `result` of a completed job (ids only, docs §9) into what the screen renders.
   * May fetch other data (item cache, catalogue products). Not used for fixture jobs — those already
   * carry the app shape.
   */
  mapResult?: (result: unknown, job: JobWire) => T | Promise<T>;
};

/**
 * The single polling hook for 202-style AI jobs (`GET v1/tenant/job/{id}`; wire status `queued |
 * processing | completed | failed` → app `queued | running | done | failed`). Polls fast at first (`jobPollInterval`, or the server's `retryAfterMs`) until `done` /
 * `failed`; pauses when the screen is unfocused (`enabled`) or the app is in the background
 * (TanStack focus manager). The job id lives in the route / persisted cache, so a restarted app
 * resumes the same job instead of starting a new one.
 */
export function useJob<T>(kind: JobKind, id: string | null | undefined, options: Options<T> = {}): JobView<T> {
  const { enabled = true, timeoutMs = JOB_TIMEOUT_MS, mapResult } = options;
  const query = useQuery({
    queryKey: jobQueryKey(id ?? 'none'),
    enabled: Boolean(id) && enabled,
    queryFn: () =>
      fromSource<Job<T>>(
        'jobs',
        () => getFixtureJob<T>(id ?? '', kind),
        async () => toJob<T>(await apiRequest<JobWire>(`v1/tenant/job/${id}`), mapResult),
      ),
    refetchInterval: (q) => {
      if (isJobSettled(q.state.data)) {
        pollStartedAt.delete(q.queryHash);
        return false;
      }
      return jobPollInterval(sincePollStart(q.queryHash), q.state.data?.retryAfterMs);
    },
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  const settled = isJobSettled(query.data);
  const [timedOutFor, setTimedOutFor] = useState<string | null>(null);
  useEffect(() => {
    if (!id || settled || !enabled) return;
    const timer = setTimeout(() => setTimedOutFor(id), timeoutMs);
    return () => clearTimeout(timer);
  }, [id, settled, enabled, timeoutMs]);

  const job = query.data;
  const timedOut = Boolean(id) && !settled && timedOutFor === id;
  const isDone = job?.status === 'done';
  const isFailed = job?.status === 'failed' || query.status === 'error' || timedOut;
  return {
    job,
    isWorking: Boolean(id) && !isDone && !isFailed,
    isDone,
    isFailed,
    timedOut,
    result: isDone ? (job?.result ?? null) : null,
    creditRefunded: job?.status === 'failed' ? (job.error?.creditRefunded ?? false) : timedOut,
    errorCode: job?.error?.code ?? null,
    error: query.error ?? null,
    refetch: () => {
      setTimedOutFor(null);
      void query.refetch();
    },
  };
}
