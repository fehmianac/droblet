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
// Teen showcase accounts (canvas 18, "Ece", 16): an e-mail starting with "ece" signs in as a teen whose parent has not
// answered yet (limited mode); "ece.onay…" as an approved teen (try-on box ticked, Teen:TryOnEnabled off → "Şu an
// kullanılamıyor"); "ece.dene…" the same with the flag on (the 22t explainer). "Kayıt ol" with a 16–17 birth year is a
// new teen with no parent e-mail yet (02i). No e-mail is sent anywhere.
let teen = null; // null = adult; else { status, requestState, parentAllowedTryOn, ownTryOnConsent, tryOnEnabled }
const iso2 = (ms) => new Date(ms).toISOString();
const teenWire = () =>
  teen
    ? {
        status: teen.status,
        request: {
          state: teen.requestState,
          parentEmailMasked: teen.requestState === 'none' ? null : 'a***@o***.com',
          sentAt: teen.requestState === 'none' ? null : iso2(now - 3600_000),
          expiresAt: teen.requestState === 'none' ? null : iso2(now + 6 * 24 * 3600_000),
          resendAvailableAt: teen.resendAt ?? null,
        },
        approvedAt: teen.status === 'active' ? iso2(now - 600_000) : null,
        parentAllowedTryOn: teen.parentAllowedTryOn,
        ownTryOnConsent: teen.ownTryOnConsent,
        ownTryOnConsentVersion: '2026-11-21',
        tryOn:
          teen.status !== 'active'
            ? { available: false, reason: 'consent_not_active' }
            : !teen.tryOnEnabled
              ? { available: false, reason: 'feature_off' }
              : !teen.parentAllowedTryOn
                ? { available: false, reason: 'parent_not_allowed' }
                : teen.ownTryOnConsent
                  ? { available: true, reason: null }
                  : { available: false, reason: 'own_consent_missing' },
        adultFrom: '2028-05-01',
        restrictions: ['social', 'commerce', 'paywall', 'firebaseAnalytics', 'firstPartyAnalytics', 'marketingNotifications', 'outfitPhotoTryOn'],
      }
    : null;
const teenState = () => ({ ageBand: teen ? 'teen' : 'adult', teen: teenWire() });
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
    teen = null;
    if (email.startsWith('ece.ret')) {
      teen = { status: 'declined', requestState: 'sent', parentAllowedTryOn: false, ownTryOnConsent: false, tryOnEnabled: false };
    } else if (email.startsWith('ece.geri')) {
      teen = { status: 'withdrawn', requestState: 'sent', parentAllowedTryOn: false, ownTryOnConsent: false, tryOnEnabled: false };
    } else if (email.startsWith('ece.18')) {
      teen = null; // turned 18: the same account, now adult
      persona = 'women';
    } else if (email.startsWith('ece.onay') || email.startsWith('ece.dene')) {
      teen = { status: 'active', requestState: 'sent', parentAllowedTryOn: true, ownTryOnConsent: false, tryOnEnabled: email.startsWith('ece.dene') };
    } else if (email.startsWith('ece')) {
      teen = { status: 'pendingParentalConsent', requestState: 'sent', parentAllowedTryOn: false, ownTryOnConsent: false, tryOnEnabled: false, resendAt: iso2(Date.now() + 42_000) };
    }
    return auth();
  },
  'POST /v1/auth/register': (req, body) => {
    persona = 'women';
    fresh = true;
    savedStyle = null;
    const age = new Date().getFullYear() - Number(body.birthYear ?? 0);
    teen = age >= 16 && age <= 17 ? { status: 'pendingParentalConsent', requestState: 'none', parentAllowedTryOn: false, ownTryOnConsent: false, tryOnEnabled: false } : null;
    return auth();
  },
  // docs/api/teen.md §5 — the teen side of the parental consent.
  'GET /v1/tenant/teen': () => teenState(),
  'POST /v1/tenant/teen/parental-consent': () => {
    if (teen) Object.assign(teen, { status: 'pendingParentalConsent', requestState: 'sent', resendAt: iso2(Date.now() + 60_000) });
    return teenState();
  },
  'POST /v1/tenant/teen/parental-consent/resend': () => {
    if (teen) teen.resendAt = iso2(Date.now() + 60_000);
    return teenState();
  },
  'PUT /v1/tenant/consents': (req, body) => {
    if (teen && (body.consents ?? []).some((c) => c.type === 'teenTryOn' && c.granted)) teen.ownTryOnConsent = true;
    return { consents: [] };
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
  'GET /v1/config': () => ({
    segments: { available: persona === 'women' && !fresh ? ['women'] : ['women', 'men'], all: ['women', 'men', 'teen'] },
    teen: { enabled: true, minimumAge: 16, adultAge: 18, tryOnEnabled: Boolean(teen?.tryOnEnabled) },
  }),
  'GET /v1/tenant/profile': (req) => ({
    tenantId: 'tenant_capture',
    displayName: teen && !fresh ? 'Ece' : fresh ? 'Deniz' : who().displayName,
    handle: fresh || teen ? null : who().handle,
    email: teen && !fresh ? 'ece@example.com' : fresh ? 'deniz@example.com' : who().email,
    closetVisibility: teen ? 'private' : 'followersOnly',
    ageConfirmedAt: iso(now),
    ageBand: teen ? 'teen' : 'adult',
    teen: teenWire(),
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
