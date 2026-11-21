// Local stand-in for the auth endpoints, used only to take the landing page's app screenshots.
// The showcase build (EXPO_PUBLIC_DROBLET_FIXTURES=1) reads every feature from fixtures, but signing in
// still goes through the API. Building with DROBLET_API_BASE_URL=http://127.0.0.1:4010 and running this
// server signs in with any e-mail/password without creating an account anywhere. Plain Node, no packages.
import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 4010);
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();

// Showcase accounts: any e-mail signs in as Damla (women, the landing captures); an e-mail starting with
// "emre" signs in as Emre, the men's showcase account (canvas 17). "Register" is a brand-new account with no
// style or body profile yet, for the onboarding captures (03a Reyon → 03 → 04). Both segments are open for
// Emre and new accounts; Damla keeps the phase-1 setting (women only), so the landing captures do not change.
let persona = 'women';
let fresh = false;
let savedStyle = null;
const readBody = (req) =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });

const auth = () => ({
  accessToken: 'capture-access-token',
  accessTokenExpiresAt: iso(now + 30 * 24 * 3600 * 1000),
  refreshToken: 'capture-refresh-token',
  refreshTokenExpiresAt: iso(now + 60 * 24 * 3600 * 1000),
  userId: 'user_capture',
  tenantId: 'tenant_capture',
  isNewUser: fresh,
});

const PROFILES = {
  women: { displayName: 'Damla', handle: 'damla', email: 'damla@example.com', styleTags: ['minimal', 'classic'], heightCm: 168, size: 'm', bodyType: 'hourglass' },
  men: { displayName: 'Emre', handle: 'emre', email: 'emre@example.com', styleTags: ['minimal', 'smartCasual', 'tailored'], heightCm: 180, size: 'l', bodyType: 'trapezoid' },
};
const who = () => PROFILES[persona];

const routes = {
  'POST /v1/auth/login': (req, body) => {
    const email = String(body.email ?? '').toLowerCase();
    persona = email.startsWith('emre') ? 'men' : 'women';
    fresh = false;
    savedStyle = null;
    return auth();
  },
  'POST /v1/auth/register': () => {
    persona = 'women';
    fresh = true;
    savedStyle = null;
    return auth();
  },
  'POST /v1/auth/refresh': auth,
  'GET /v1/tenant/style-profile': () =>
    fresh
      ? savedStyle
      : { segment: persona, styleTags: who().styleTags, budget: 'mixed', version: 1, updatedAt: iso(now) },
  'PUT /v1/tenant/style-profile': (req, body) => {
    savedStyle = { segment: body.segment, styleTags: body.styleTags, budget: body.budget, version: (savedStyle?.version ?? 0) + 1, updatedAt: iso(Date.now()) };
    return savedStyle;
  },
  'GET /v1/tenant/body-profile': () =>
    fresh ? null : { heightCm: who().heightCm, weightKg: null, size: who().size, bodyType: who().bodyType, version: 1, updatedAt: iso(now) },
  'PUT /v1/tenant/body-profile': (req, body) => ({ heightCm: body.heightCm, weightKg: body.weightKg ?? null, size: body.size, bodyType: body.bodyType ?? null, version: (body.baseVersion ?? 0) + 1, updatedAt: iso(Date.now()) }),
  // A member with most of this month's AI images left (the Profil credit counter).
  'GET /v1/tenant/entitlement': () => ({
    tier: 'premium',
    productId: 'droblet.membership.yearly',
    platform: 'apple',
    expiresAt: iso(now + 300 * 24 * 3600 * 1000),
    credits: { monthlyAllowance: 30, allowanceRemaining: 24, packRemaining: 0, totalRemaining: 24, resetsAt: null },
    itemRecognition: { limit: null, used: 14, remaining: null },
  }),
  // docs/api/segments.md §1: open segments (the app reads the ids only).
  'GET /v1/config': () => ({ segments: { available: persona === 'women' && !fresh ? ['women'] : ['women', 'men'], all: ['women', 'men', 'teen'] } }),
  'GET /v1/tenant/profile': (req) => ({
    tenantId: 'tenant_capture',
    displayName: fresh ? 'Deniz' : who().displayName,
    handle: fresh ? null : who().handle,
    email: fresh ? 'deniz@example.com' : who().email,
    closetVisibility: 'followersOnly',
    // The capture language (the app sends it as Accept-Language), so the profile never switches the app back.
    language: process.env.CAPTURE_LANG ?? ((req.headers['accept-language'] ?? '').toLowerCase().startsWith('en') ? 'en' : 'tr'),
    cityId: null,
    version: 1,
    updatedAt: iso(now),
  }),
};

createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  const handler = routes[`${req.method} ${path}`];
  const body = await readBody(req);
  const result = handler ? handler(req, body) : undefined;
  // A handler answering null is "not set yet" (404), like the API's style / body profile of a new account.
  const status = handler && result !== null ? 200 : req.method === 'GET' ? 404 : 204;
  console.log(`${req.method} ${path} -> ${status}`);
  if (status === 200) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
  } else if (status === 404) {
    res.writeHead(404, { 'content-type': 'application/problem+json' });
    res.end(JSON.stringify({ status: 404, code: 'not_found' }));
  } else {
    res.writeHead(204);
    res.end();
  }
}).listen(port, '127.0.0.1', () => console.log(`mock auth on http://127.0.0.1:${port}`));
