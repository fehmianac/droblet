/**
 * Long-running AI jobs as the app sees them. On the wire (`GET v1/tenant/job/{id}`, `JobWire` in
 * `../wire/core`) the status is `queued | processing | completed | failed` and a failed job carries a
 * `failure` enum; `toJob` maps both. A start request (202) answers the wire job (or `{ status, job }`);
 * the hooks reduce it to `JobAccepted`.
 */
export type JobKind = 'stylist-outfit' | 'stylist-week' | 'stylist-complete' | 'tryon' | 'item-process' | 'trip-pack' | 'palette';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

/** What a start hook resolves with: the id to poll. Starts are idempotent on the request's `requestId`. */
export type JobAccepted = { jobId: string };

export type JobError = {
  /** App code from the wire `failure`: `generation_failed`, `generation_timeout`, `guard_rejected`, `source_deleted`, `no_face_detected`. */
  code: string;
  /** True when the reserved credit was given back (the UI says so). */
  creditRefunded: boolean;
};

/** GET v1/tenant/job/{id} */
export type Job<TResult> = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  /** Always null from the API (drafts carry their own `total` / `processed`); fixtures may set it. */
  progress: { done: number; total: number } | null;
  /** Present when `status === 'done'`. */
  result: TResult | null;
  /** Present when `status === 'failed'`. */
  error: JobError | null;
};
