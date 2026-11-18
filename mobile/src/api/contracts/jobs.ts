/**
 * Long-running AI jobs — PROVISIONAL (BACKEND_ENGINEER §Uç nokta haritası: `GET v1/tenant/job/{id}`).
 * A start request (`POST …`, 202) answers `JobAccepted`; the app then polls the job.
 */
export type JobKind = 'stylist-outfit' | 'stylist-week' | 'stylist-complete' | 'tryon' | 'item-process' | 'trip-pack' | 'palette';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

/** 202 body of every job-starting POST. Idempotent on the request's `requestId`. */
export type JobAccepted = { jobId: string };

export type JobError = {
  /** Machine code, e.g. `generation_failed`, `monthly_limit_reached`, `body_photo_required`. */
  code: string;
  /** True when the reserved credit was given back (the UI says so). */
  creditRefunded: boolean;
};

/** GET v1/tenant/job/{id} */
export type Job<TResult> = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  /** Optional server progress (e.g. bulk add "8 / 12"). */
  progress: { done: number; total: number } | null;
  /** Present when `status === 'done'`. */
  result: TResult | null;
  /** Present when `status === 'failed'`. */
  error: JobError | null;
};
