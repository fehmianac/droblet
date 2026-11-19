// Local stand-in for the auth endpoints, used only to take the landing page's app screenshots.
// The showcase build (EXPO_PUBLIC_DROBLET_FIXTURES=1) reads every feature from fixtures, but signing in
// still goes through the API. Building with DROBLET_API_BASE_URL=http://127.0.0.1:4010 and running this
// server signs in with any e-mail/password without creating an account anywhere. Plain Node, no packages.
import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 4010);
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();

const auth = () => ({
  accessToken: 'capture-access-token',
  accessTokenExpiresAt: iso(now + 30 * 24 * 3600 * 1000),
  refreshToken: 'capture-refresh-token',
  refreshTokenExpiresAt: iso(now + 60 * 24 * 3600 * 1000),
  userId: 'user_capture',
  tenantId: 'tenant_capture',
  isNewUser: false,
});

const routes = {
  'POST /v1/auth/login': auth,
  'POST /v1/auth/refresh': auth,
  'GET /v1/tenant/style-profile': () => ({
    segment: 'women',
    styleTags: ['minimal', 'classic'],
    budget: 'mixed',
    version: 1,
    updatedAt: iso(now),
  }),
  'GET /v1/tenant/body-profile': () => ({ heightCm: 168, weightKg: null, size: 'm', bodyType: 'hourglass', version: 1, updatedAt: iso(now) }),
  // A member with most of this month's AI images left (the Profil credit counter).
  'GET /v1/tenant/entitlement': () => ({
    tier: 'premium',
    productId: 'droblet.membership.yearly',
    platform: 'apple',
    expiresAt: iso(now + 300 * 24 * 3600 * 1000),
    credits: { monthlyAllowance: 30, allowanceRemaining: 24, packRemaining: 0, totalRemaining: 24, resetsAt: null },
    itemRecognition: { limit: null, used: 14, remaining: null },
  }),
  'GET /v1/tenant/profile': (req) => ({
    tenantId: 'tenant_capture',
    displayName: 'Damla',
    handle: 'damla',
    email: 'damla@example.com',
    closetVisibility: 'followersOnly',
    // The capture language (the app sends it as Accept-Language), so the profile never switches the app back.
    language: process.env.CAPTURE_LANG ?? ((req.headers['accept-language'] ?? '').toLowerCase().startsWith('en') ? 'en' : 'tr'),
    cityId: null,
    version: 1,
    updatedAt: iso(now),
  }),
};

createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  const handler = routes[`${req.method} ${path}`];
  req.resume();
  const status = handler ? 200 : req.method === 'GET' ? 404 : 204;
  console.log(`${req.method} ${path} -> ${status}`);
  if (handler) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(handler(req)));
  } else if (status === 404) {
    res.writeHead(404, { 'content-type': 'application/problem+json' });
    res.end(JSON.stringify({ status: 404, code: 'not_found' }));
  } else {
    res.writeHead(204);
    res.end();
  }
}).listen(port, '127.0.0.1', () => console.log(`mock auth on http://127.0.0.1:${port}`));
