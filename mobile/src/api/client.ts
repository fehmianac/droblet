import { singleFlight } from '@/auth/singleFlight';
import { sessionStore } from '@/auth/session';
import { currentLanguage } from '@/i18n';

import { apiBaseUrl } from './config';
import type { AuthResponse, ProblemDetails, RefreshRequest } from './contracts';
import { ApiError } from './errors';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type RequestOptions = {
  method?: Method;
  body?: unknown;
  /** Sends the bearer token and handles 401 → refresh → retry once. Default true. */
  auth?: boolean;
  signal?: AbortSignal;
};

/** Refresh slightly before expiry so a request never leaves with a dead token. */
const EXPIRY_SKEW_MS = 30_000;

function baseUrlOrThrow(): string {
  const base = apiBaseUrl();
  if (!base) throw new ApiError('config', null, null);
  return base;
}

async function parseProblem(res: Response): Promise<ProblemDetails | null> {
  try {
    const text = await res.text();
    return text ? (JSON.parse(text) as ProblemDetails) : null;
  } catch {
    return null;
  }
}

async function rawFetch(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${baseUrlOrThrow()}/${path.replace(/^\/+/, '')}`, init);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof Error && e.name === 'AbortError') throw e;
    throw new ApiError('network', null, null);
  }
}

/**
 * Single-flight token refresh. Network failure keeps the session (offline ≠ signed out);
 * a rejected refresh token ends the session but keeps the user's queued writes.
 */
export const refreshTokens = singleFlight(async (): Promise<string> => {
  const tokens = sessionStore.getTokens();
  if (!tokens) throw new ApiError('session_expired', 401, null);
  const body: RefreshRequest = { refreshToken: tokens.refreshToken };
  const res = await rawFetch('v1/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    await sessionStore.clear('expired');
    throw new ApiError('session_expired', res.status, await parseProblem(res));
  }
  if (!res.ok) throw new ApiError('http', res.status, await parseProblem(res));
  const auth = (await res.json()) as AuthResponse;
  await sessionStore.setFromAuthResponse(auth);
  return auth.accessToken;
});

async function accessToken(): Promise<string> {
  const tokens = sessionStore.getTokens();
  if (!tokens) throw new ApiError('session_expired', 401, null);
  if (tokens.expiresAt - EXPIRY_SKEW_MS > Date.now()) return tokens.accessToken;
  return refreshTokens();
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, signal } = options;

  const send = async (token: string | null) => {
    // The server localizes content, e-mails and error text to the active app language.
    const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': currentLanguage() };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    return rawFetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  };

  let res = await send(auth ? await accessToken() : null);
  if (auth && res.status === 401) {
    res = await send(await refreshTokens());
  }

  if (!res.ok) {
    throw new ApiError('http', res.status, await parseProblem(res));
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
