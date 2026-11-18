import type { ProblemDetails } from './contracts';

export type ApiErrorKind = 'http' | 'network' | 'config' | 'session_expired';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly problem: ProblemDetails | null;

  constructor(kind: ApiErrorKind, status: number | null, problem: ProblemDetails | null) {
    super(problem?.detail ?? problem?.title ?? kind);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = problem?.code ?? null;
    this.problem = problem;
  }
}

/** Error codes that have their own translation under `errors.*`. */
const KNOWN_CODES = [
  'email_taken',
  'invalid_credentials',
  'invalid_reset_token',
  'rate_limited',
  'session_expired',
  'monthly_limit_reached',
] as const;
export type KnownErrorCode = (typeof KNOWN_CODES)[number] | 'network' | 'config_missing' | 'unknown';

/**
 * Maps any thrown value to a translation key under `errors.*`.
 * "Bir şeyler ters gitti" (`unknown`) is the last resort (MOBILE_ENGINEER §API conventions).
 */
export function extractApiError(error: unknown): KnownErrorCode {
  if (!(error instanceof ApiError)) return 'unknown';
  if (error.kind === 'network') return 'network';
  if (error.kind === 'config') return 'config_missing';
  if (error.kind === 'session_expired') return 'session_expired';
  const code = error.code as (typeof KNOWN_CODES)[number] | null;
  if (code && (KNOWN_CODES as readonly string[]).includes(code)) return code;
  if (error.status === 429) return 'rate_limited';
  return 'unknown';
}

/** Field-level validation messages from ProblemDetails `errors`, keyed by lower-camel field name. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !error.problem?.errors) return {};
  const out: Record<string, string> = {};
  for (const [field, messages] of Object.entries(error.problem.errors)) {
    const key = field.charAt(0).toLowerCase() + field.slice(1);
    if (messages[0]) out[key] = messages[0];
  }
  return out;
}

export function isConflict(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 409;
}

export function isGone(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 404;
}
