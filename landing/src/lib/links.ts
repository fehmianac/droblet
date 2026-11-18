import { appScheme } from './site';

/**
 * Deep-link parameters are read in the browser: nothing runs at request time on a static bucket.
 *
 * A fallback page is reachable two ways:
 *   - `/invite/?c=CODE`, `/l/?id=ID` — works on plain S3;
 *   - `/invite/CODE`, `/l/ID` — the shared form; a Cloudflare rewrite serves the same index.html, so the
 *     value is still in `location.pathname`.
 */
const SAFE_VALUE = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_TOKEN = /^[A-Za-z0-9._~-]{8,200}$/;

function safe(value: string | null | undefined, pattern: RegExp): string | null {
  if (!value) return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  return pattern.test(decoded) ? decoded : null;
}

/** The segment after `/{section}/` in the current path, if the page was reached through the rewrite. */
function pathValue(section: string, pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  const at = segments.indexOf(section);
  const next = at === -1 ? undefined : segments[at + 1];
  return next && next !== 'index.html' ? next : null;
}

export function readInviteCode(location: Location): string | null {
  const query = new URLSearchParams(location.search);
  return safe(query.get('c'), SAFE_VALUE) ?? safe(pathValue('invite', location.pathname), SAFE_VALUE);
}

export function readLook(location: Location): { id: string | null; invite: string | null } {
  const query = new URLSearchParams(location.search);
  return {
    id: safe(query.get('id'), SAFE_VALUE) ?? safe(pathValue('l', location.pathname), SAFE_VALUE),
    // Every shared look link carries the sharer's invite code.
    invite: safe(query.get('invite'), SAFE_VALUE),
  };
}

export function readResetToken(location: Location): string | null {
  return safe(new URLSearchParams(location.search).get('token'), SAFE_TOKEN);
}

/** Custom-scheme links the app maps itself (mobile/src/features/social/deepLinks.ts). */
export const appLinks = {
  invite: (code: string) => `${appScheme}://invite/${encodeURIComponent(code)}`,
  look: (id: string, invite: string | null) =>
    `${appScheme}://l/${encodeURIComponent(id)}${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`,
  resetPassword: (token: string) => `${appScheme}://reset-password?token=${encodeURIComponent(token)}`,
  home: () => `${appScheme}://`,
};
