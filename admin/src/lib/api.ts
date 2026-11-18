import type { AdminSession } from './types';

// NEXT_PUBLIC_API_BASE_URL is inlined at build time (deploy-admin.yml: vars.API_BASE_URL). Trailing slashes are ignored.
const BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
const REFRESH_KEY = 'droblet-admin.refresh';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public errors: Record<string, string[]> = {},
    public body: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

// Access token: memory only (never in storage). Refresh token: sessionStorage (per tab, gone when the tab closes).
let accessToken: string | null = null;
let language = 'tr';
let refreshing: Promise<AdminSession | null> | null = null;
const sessionListeners = new Set<(session: AdminSession | null) => void>();

export function onSessionChange(listener: (session: AdminSession | null) => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

export function setLanguage(lang: string) {
  language = lang;
}

export function apiUrl(path: string): string {
  return `${BASE}/${path.replace(/^\/+/, '')}`;
}

function readRefresh(): string | null {
  try {
    return sessionStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export function hasStoredSession(): boolean {
  return readRefresh() !== null;
}

export function storeSession(session: AdminSession | null) {
  accessToken = session?.accessToken ?? null;
  try {
    if (session) sessionStorage.setItem(REFRESH_KEY, session.refreshToken);
    else sessionStorage.removeItem(REFRESH_KEY);
  } catch {
    // Storage blocked: the session lasts as long as the page.
  }
  sessionListeners.forEach((l) => l(session));
}

export function currentRefreshToken(): string | null {
  return readRefresh();
}

async function parseError(res: Response): Promise<ApiError> {
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // empty body (401 / 403 from the auth middleware)
  }
  const code =
    typeof body.code === 'string'
      ? body.code
      : res.status === 401
        ? 'unauthorized'
        : res.status === 403
          ? 'forbidden'
          : res.status === 404
            ? 'not_found'
            : res.status === 429
              ? 'too_many_requests'
              : 'generic';
  const errors = (body.errors as Record<string, string[]> | undefined) ?? {};
  return new ApiError(res.status, code, errors, body);
}

/** Refreshes once even when many requests hit 401 at the same time. */
export function refreshSession(): Promise<AdminSession | null> {
  if (refreshing) return refreshing;
  const token = readRefresh();
  if (!token) return Promise.resolve(null);
  refreshing = (async () => {
    try {
      const res = await fetch(apiUrl('v1/admin/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': language },
        body: JSON.stringify({ refreshToken: token }),
      });
      if (!res.ok) {
        // Only a definite answer ends the session; a network blip keeps the stored token.
        if (res.status === 401 || res.status === 400) storeSession(null);
        return null;
      }
      const session = (await res.json()) as AdminSession;
      storeSession(session);
      return session;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

interface Options {
  auth?: boolean;
  query?: Record<string, string | number | boolean | null | undefined>;
}

async function request<T>(method: string, path: string, body: unknown, options: Options, retry: boolean): Promise<T> {
  const auth = options.auth ?? true;
  let url = apiUrl(path);
  if (options.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  const headers: Record<string, string> = { 'Accept-Language': language };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'network');
  }

  if (res.status === 401 && auth && retry) {
    const session = await refreshSession();
    if (session) return request<T>(method, path, body, options, false);
    storeSession(null);
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204 || res.status === 202) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string, options: Options = {}) => request<T>('GET', path, undefined, options, true),
  post: <T>(path: string, body?: unknown, options: Options = {}) => request<T>('POST', path, body ?? {}, options, true),
  put: <T>(path: string, body: unknown, options: Options = {}) => request<T>('PUT', path, body, options, true),
  del: <T = void>(path: string, options: Options = {}) => request<T>('DELETE', path, undefined, options, true),
};

/** Presigned POST to the public catalog image bucket (v1/admin/image/upload-url). */
export async function uploadToSlot(slot: { url: string; fields: Record<string, string> }, file: File): Promise<void> {
  const form = new FormData();
  for (const [k, v] of Object.entries(slot.fields)) form.append(k, v);
  form.append('file', file);
  let res: Response;
  try {
    res = await fetch(slot.url, { method: 'POST', body: form });
  } catch {
    throw new ApiError(0, 'network');
  }
  if (!res.ok) throw new ApiError(res.status, 'upload_failed');
}
