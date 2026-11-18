import { apiBaseUrl } from './site';

/**
 * Minimal browser client for the three anonymous / bearer calls this site makes. Errors are reduced to
 * the API's stable snake_case `code` (ProblemDetails extension); the page maps the code to a sentence.
 */
export type ApiFailure = { ok: false; status: number; code: string };
export type ApiSuccess<T> = { ok: true; status: number; data: T };
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

type RequestOptions = {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: unknown;
  token?: string;
  language: string;
};

function readCode(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  // Validation problems (400) answer `validation_failed` with a per-field `errors` map; one sentence covers them.
  if (record.code === 'validation_failed' || (typeof record.errors === 'object' && record.errors !== null)) return 'validation';
  if (typeof record.code === 'string' && record.code) return record.code;
  return null;
}

export async function apiRequest<T>({ method, path, body, token, language }: RequestOptions): Promise<ApiResult<T>> {
  if (!apiBaseUrl) return { ok: false, status: 0, code: 'unavailable' };

  const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': language };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // No cookies: the API authenticates with the bearer token only.
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 0, code: 'network' };
  }

  let payload: unknown = null;
  if (response.status !== 204) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }

  if (response.ok) return { ok: true, status: response.status, data: payload as T };

  const fallback = response.status === 401 ? 'unauthorized' : response.status === 429 ? 'too_many_attempts' : 'unknown';
  return { ok: false, status: response.status, code: readCode(payload) ?? fallback };
}

/** Picks the sentence for an error code, falling back to `unknown`. */
export function errorMessage(messages: Record<string, string> & { unknown: string }, code: string): string {
  return messages[code] ?? messages.unknown;
}
