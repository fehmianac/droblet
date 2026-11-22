/**
 * Incoming links → app routes (MOBILE_ENGINEER §Deep link).
 *
 *   droplet://invite/{code}  ·  https://droblet.alatech.co/invite/{code}   → 27 Dolapları keşfet
 *   …/i/{code}[?t=look|profile|product|edit&id=…&u=handle]                → the server's share / invite link
 *     (`GET v1/tenant/invite/link`, `POST v1/tenant/share`): look → 25, profile → 26, product → 22,
 *     edit → 08, otherwise 27
 *   …/l/{lookId}[?invite=code]                                            → 25 Arkadaş akışı, that look first
 *   …/u/{handle}[?invite=code]                                            → 26 Kişi profili
 *   droplet://today                                                       → 06 Bugün
 *   …/reset-password[/]?token=…  ·  …/verify-email[/]?token=… (also under /en/) → 02d Yeni şifre / E-postanı doğrula
 *
 * Every shared link carries the sharer's invite code; it is returned separately so the caller can
 * keep it until sign-up, and removed from the rewritten route. Unknown links pass through unchanged
 * (edit/{id}, look/{id} … are real routes already).
 */
export type MappedLink = { path: string; inviteCode: string | null };

const CODE = /^[A-Za-z0-9_-]{3,64}$/;

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function sanitizeCode(value: string | undefined | null): string | null {
  if (!value) return null;
  const code = decode(value);
  return CODE.test(code) ? code : null;
}

export function mapIncomingLink(input: string): MappedLink {
  let rest = input.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(rest);
  if (scheme) {
    rest = rest.slice(scheme[0].length);
    // Web links carry the host first; in custom-scheme links the first segment is already the route.
    if (/^https?$/i.test(scheme[1] ?? '')) rest = rest.slice(rest.indexOf('/') === -1 ? rest.length : rest.indexOf('/'));
  }
  // Expo Go / dev-client URLs put the route after "/--/".
  const devMarker = rest.indexOf('/--/');
  if (devMarker !== -1) rest = rest.slice(devMarker + 3);
  const [rawPath = '', rawQuery = ''] = rest.split('#')[0]?.split('?') ?? [];
  const segments = rawPath.split('/').filter(Boolean);

  const params = rawQuery
    .split('&')
    .filter(Boolean)
    .map((pair) => pair.split('='))
    .map(([key = '', value = '']) => [key, value] as const);
  let inviteCode = sanitizeCode(params.find(([key]) => key === 'invite')?.[1]);
  const otherParams = params.filter(([key]) => key !== 'invite').map(([key, value]) => `${key}=${value}`);
  const withQuery = (path: string, extra: string[] = []) => {
    const query = [...extra, ...otherParams];
    return query.length > 0 ? `${path}?${query.join('&')}` : path;
  };

  const [first, second] = segments;
  if (first === 'invite' && second) {
    inviteCode = sanitizeCode(second) ?? inviteCode;
    return { path: withQuery('/friends/find'), inviteCode };
  }
  if (first === 'i' && second) {
    inviteCode = sanitizeCode(second) ?? inviteCode;
    const param = (key: string) => {
      const value = params.find(([k]) => k === key)?.[1];
      return value ? decode(value) : null;
    };
    const kind = param('t');
    const targetId = param('id');
    const owner = param('u');
    if (kind === 'look' && targetId) return { path: `/friends/feed?look=${encodeURIComponent(targetId)}`, inviteCode };
    if (kind === 'profile' && owner) return { path: `/u/${encodeURIComponent(owner)}`, inviteCode };
    if (kind === 'product' && targetId) return { path: `/shop/product/${encodeURIComponent(targetId)}`, inviteCode };
    if (kind === 'edit' && targetId) return { path: `/edit/${encodeURIComponent(targetId)}`, inviteCode };
    return { path: '/friends/find', inviteCode };
  }
  if (first === 'l' && second) {
    return { path: withQuery('/friends/feed', [`look=${encodeURIComponent(decode(second))}`]), inviteCode };
  }
  if (first === 'u' && second) {
    return { path: withQuery(`/u/${encodeURIComponent(decode(second))}`), inviteCode };
  }
  // E-mail links: `/reset-password/?token=…` and `/verify-email/?token=…` (the trailing-slash form the site serves;
  // the no-slash form and an `/en/` language prefix too) → the app routes with the token, nothing else changed.
  const emailRoute = first === 'en' ? second : first;
  if ((emailRoute === 'reset-password' || emailRoute === 'verify-email') && segments.length === (first === 'en' ? 2 : 1)) {
    return { path: withQuery(`/${emailRoute}`), inviteCode };
  }
  if (first === 'today' && segments.length === 1) {
    return { path: withQuery('/today'), inviteCode };
  }
  // Not one of ours to rewrite: hand the link back untouched.
  return { path: input, inviteCode };
}
