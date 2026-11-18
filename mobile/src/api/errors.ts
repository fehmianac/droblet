import type { ProblemDetails } from './contracts';
import { isConsentType, type ConsentType } from './contracts/consents';

export type ApiErrorKind = 'http' | 'network' | 'config' | 'session_expired';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly problem: ProblemDetails | null;
  /**
   * On 409 of a versioned PUT the server answers with the current record itself (same shape as 200),
   * not with a ProblemDetails. Null for coded conflicts (`handle_taken`, `request_id_reused`, …).
   */
  readonly current: unknown;

  constructor(kind: ApiErrorKind, status: number | null, problem: ProblemDetails | null) {
    super(problem?.detail ?? problem?.title ?? kind);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = problem?.code ?? null;
    this.problem = problem;
    this.current = status === 409 && problem && !problem.code ? (problem.current ?? problem) : null;
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
  'account_suspended',
] as const;

/** Server codes that share a translation with a known code. */
const CODE_ALIASES: Record<string, (typeof KNOWN_CODES)[number]> = {
  too_many_attempts: 'rate_limited',
  invalid_or_expired_token: 'invalid_reset_token',
  invalid_refresh_token: 'session_expired',
  credits_exhausted: 'monthly_limit_reached',
};
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
  if (error.code && CODE_ALIASES[error.code]) return CODE_ALIASES[error.code];
  if (error.status === 429) return 'rate_limited';
  return 'unknown';
}

/**
 * Field-level validation CODES from ProblemDetails `errors` (`{ "email": ["email_invalid"] }`), keyed
 * by lower-camel field name. The API never sends sentences — translate the code before showing it.
 */
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

/** The server's stable snake_case `code` of a failed request, or null (network, non-API error). */
export function apiErrorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}

/** 403 `premium_required` or 402 `item_recognition_limit_reached` → the paywall (05). */
export function isPaywallError(error: unknown): boolean {
  const code = apiErrorCode(error);
  return code === 'premium_required' || code === 'item_recognition_limit_reached';
}

/** 402 `credits_exhausted` → the credit-pack sheet (05b), never the paywall. */
export function isCreditsExhausted(error: unknown): boolean {
  return apiErrorCode(error) === 'credits_exhausted';
}

/** 403 `consent_required`: an explicit consent is missing (see `missingConsents`). */
export function isConsentRequired(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 403 && error.code === 'consent_required';
}

/** The consent types a `consent_required` answer lists (unknown values are dropped); [] for any other error. */
export function missingConsents(error: unknown): ConsentType[] {
  if (!isConsentRequired(error)) return [];
  const missing = error.problem?.missing;
  return Array.isArray(missing) ? missing.filter(isConsentType) : [];
}
