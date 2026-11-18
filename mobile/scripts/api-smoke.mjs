#!/usr/bin/env node
/**
 * API smoke test — exercises the real backend with the same request shapes the app sends
 * (src/api/wire/*, feature hooks). Node 20+, no dependencies.
 *
 *   node scripts/api-smoke.mjs                       # dev API
 *   DROBLET_API_BASE_URL=https://… node scripts/api-smoke.mjs
 *
 * Registers two fresh `smoke+<timestamp>@example.com` users, walks every feature, prints a
 * pass / fail table and deletes both users at the end (`DELETE v1/auth/me`).
 * Steps for endpoints that exist only in this branch report "not deployed yet" on 404 instead of failing.
 * Exit code 1 when a step failed.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

const BASE = (process.env.DROBLET_API_BASE_URL ?? 'https://b8lvaj4r5e.execute-api.eu-central-1.amazonaws.com').replace(/\/+$/, '');
const PASSWORD = 'Sm0keTest2026';
const STAMP = Date.now();

// ---------- helpers ----------

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid() {
  let time = Date.now();
  let out = '';
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[time % 32] + out;
    time = Math.floor(time / 32);
  }
  for (let i = 0; i < 16; i++) out += ALPHABET[Math.floor(Math.random() * 32)];
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDays(days, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}
function mondayOf(d = new Date()) {
  const day = (d.getDay() + 6) % 7;
  return addDays(-day, d);
}

async function call(method, path, { body, token, language = 'tr-TR' } = {}) {
  const headers = { Accept: 'application/json', 'Accept-Language': language };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${BASE}/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    return { status: 0, json: null, text: String(e) };
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text };
}

const rows = [];
let failed = 0;

/** Records one row. `ok` may be true / false / 'skip' (not deployed, not applicable). */
function record(feature, step, res, ok, note = '') {
  const result = ok === 'skip' ? 'SKIP' : ok ? 'PASS' : 'FAIL';
  if (result === 'FAIL') failed++;
  const code = res?.json && typeof res.json === 'object' && !Array.isArray(res.json) ? (res.json.code ?? '') : '';
  rows.push({ feature, step, status: res ? String(res.status) : '-', result, note: [code && result !== 'PASS' ? code : '', note].filter(Boolean).join(' · ') });
  return result === 'PASS';
}

/** A step that must answer one of `expected` statuses (and optionally an error `code`). */
async function step(feature, name, method, path, options = {}, expected = [200], check) {
  const res = await call(method, path, options);
  let ok = expected.includes(res.status);
  let note = '';
  if (ok && check) {
    try {
      const out = check(res.json, res);
      if (out === false) ok = false;
      else if (typeof out === 'string') note = out;
    } catch (e) {
      ok = false;
      note = `shape: ${e.message}`;
    }
  }
  record(feature, `${method} ${name}`, res, ok, note || (ok ? '' : res.text.slice(0, 120)));
  return res;
}

/** For endpoints added in this branch: 404 without the endpoint's own code = not deployed yet. */
async function branchStep(feature, name, method, path, options, expected, check) {
  const res = await call(method, path, options);
  if (res.status === 404 && !(res.json && res.json.code && res.json.code !== 'not_found')) {
    record(feature, `${method} ${name}`, res, 'skip', 'not deployed yet (added in this branch)');
    return res;
  }
  if (res.status === 405) {
    record(feature, `${method} ${name}`, res, 'skip', 'not deployed yet (added in this branch)');
    return res;
  }
  let ok = expected.includes(res.status);
  let note = '';
  if (ok && check) {
    try {
      const out = check(res.json);
      if (out === false) ok = false;
      else if (typeof out === 'string') note = out;
    } catch (e) {
      ok = false;
      note = `shape: ${e.message}`;
    }
  }
  record(feature, `${method} ${name}`, res, ok, note);
  return res;
}

/** The profile's current version (baseVersion of profile / visibility PUTs) — other writes move it too. */
async function profileVersionOf(auth) {
  return (await call('GET', 'v1/tenant/profile', auth)).json?.version ?? 1;
}

const need = (cond, message) => {
  if (!cond) throw new Error(message);
};
const has = (obj, ...keys) => keys.forEach((k) => need(obj && k in obj, `missing ${k}`));

// 1×1 JPEG
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=',
  'base64',
);

/** Presigned S3 POST: every field first, then the file as `file` (same as sync/photoUpload.ts). */
async function postToPresigned(upload) {
  const form = new FormData();
  for (const [k, v] of Object.entries(upload.fields)) form.append(k, v);
  form.append('file', new Blob([JPEG], { type: 'image/jpeg' }), 'photo.jpg');
  try {
    const res = await fetch(upload.url, { method: 'POST', body: form });
    return { status: res.status, json: null, text: await res.text() };
  } catch (e) {
    return { status: 0, json: null, text: String(e) };
  }
}

async function registerUser(label) {
  const email = `smoke+${STAMP}${label}@example.com`;
  const res = await step('auth', `v1/auth/register (${label})`, 'POST', 'v1/auth/register', { body: { name: `Smoke ${label.toUpperCase()}`, email, password: PASSWORD, ageConfirmed: true } }, [201], (j) => {
    has(j, 'accessToken', 'accessTokenExpiresAt', 'refreshToken', 'refreshTokenExpiresAt', 'userId', 'tenantId', 'isNewUser');
    need(j.isNewUser === true, 'isNewUser must be true on register');
  });
  return { email, token: res.json?.accessToken ?? null, refreshToken: res.json?.refreshToken ?? null, userId: res.json?.userId ?? null };
}

// ---------- the walk ----------

async function main() {
  console.log(`Droblet API smoke — ${BASE}\n`);
  const today = isoDate();
  const a = await registerUser('a');
  const b = await registerUser('b');
  if (!a.token || !b.token) {
    print();
    process.exit(1);
  }
  const A = { token: a.token };
  const B = { token: b.token };

  try {
    // ----- auth -----
    await step('auth', 'v1/auth/register (same e-mail)', 'POST', 'v1/auth/register', { body: { name: 'Smoke', email: a.email, password: PASSWORD, ageConfirmed: true } }, [409], (j) => need(j.code === 'email_taken', 'code'));
    // 18+ (Terms §3): the sign-up box is required.
    await step('age', 'v1/auth/register (no age confirmation)', 'POST', 'v1/auth/register', { body: { name: 'Smoke', email: `smoke+${STAMP}minor@example.com`, password: PASSWORD } }, [400], (j) =>
      need(JSON.stringify(j.errors ?? {}).includes('age_confirmation_required'), 'age_confirmation_required'),
    );
    const login = await step('auth', 'v1/auth/login', 'POST', 'v1/auth/login', { body: { email: a.email, password: PASSWORD } }, [200], (j) => need(j.isNewUser === false, 'isNewUser must be false on login'));
    await step('auth', 'v1/auth/login (wrong password)', 'POST', 'v1/auth/login', { body: { email: a.email, password: 'wrong-password-1' } }, [401], (j) => need(j.code === 'invalid_credentials', 'code'));
    if (login.json?.refreshToken) {
      const refreshed = await step('auth', 'v1/auth/refresh', 'POST', 'v1/auth/refresh', { body: { refreshToken: login.json.refreshToken } }, [200], (j) => has(j, 'accessToken', 'refreshToken'));
      if (refreshed.json?.accessToken) {
        await step('auth', 'v1/auth/logout', 'POST', 'v1/auth/logout', { token: refreshed.json.accessToken, body: { refreshToken: refreshed.json.refreshToken } }, [204]);
      }
    }
    await step('auth', 'v1/auth/password/forgot', 'POST', 'v1/auth/password/forgot', { body: { email: a.email } }, [202, 204]);

    // ----- profile / onboarding -----
    const profile = await step('profile', 'v1/tenant/profile', 'GET', 'v1/tenant/profile', A, [200], (j) => {
      has(j, 'tenantId', 'displayName', 'handle', 'email', 'closetVisibility', 'language', 'cityId', 'version', 'ageConfirmedAt', 'avatarUrl');
      need(j.ageConfirmedAt !== null, 'e-mail sign-up confirmed the age');
    });
    await step('age', 'v1/tenant/profile/age-confirmation (idempotent)', 'POST', 'v1/tenant/profile/age-confirmation', A, [200], (j) =>
      need(j.ageConfirmedAt === profile.json?.ageConfirmedAt, 'keeps the first timestamp'),
    );

    // ----- explicit consents (Açık rıza 1–6) -----
    const CONSENT_VERSION = '2026-11-19';
    const consentTypes = ['bodyPhotoAi', 'facePhotoPalette', 'weight', 'contacts', 'marketingNotifications', 'crossBorderTransfer'];
    await step('consents', 'v1/tenant/consents (new user)', 'GET', 'v1/tenant/consents', A, [200], (j) => {
      need(consentTypes.every((t) => j.consents.some((c) => c.type === t)), 'all six types');
      need(j.consents.every((c) => c.valid === false), 'nothing given yet');
      return `currentVersion ${j.consents[0]?.currentVersion}`;
    });
    await step('consents', 'v1/tenant/photo/upload-url (no consent)', 'POST', 'v1/tenant/photo/upload-url', { ...A, body: { kind: 'body', contentType: 'image/jpeg' } }, [403], (j) =>
      need(j.code === 'consent_required' && j.missing.includes('bodyPhotoAi') && j.missing.includes('crossBorderTransfer'), 'consent_required + missing'),
    );
    await step('consents', 'v1/tenant/body-profile (weight, no consent)', 'PUT', 'v1/tenant/body-profile', { ...A, body: { heightCm: 170, weightKg: 60, size: 'M', baseVersion: 0 } }, [403], (j) =>
      need(j.code === 'consent_required' && j.missing.includes('weight'), 'weight consent'),
    );
    await step('consents', 'v1/tenant/consents (outdated text version)', 'PUT', 'v1/tenant/consents', { ...A, body: { consents: [{ type: 'weight', granted: true, version: '2000-01-01' }], source: 'weight', locale: 'tr' } }, [409], (j) =>
      need(j.code === 'consent_version_outdated', 'code'),
    );
    const given = ['bodyPhotoAi', 'facePhotoPalette', 'contacts', 'crossBorderTransfer', 'weight'];
    await step('consents', 'v1/tenant/consents (grant)', 'PUT', 'v1/tenant/consents', { ...A, body: { consents: given.map((type) => ({ type, granted: true, version: CONSENT_VERSION })), source: 'onboarding', locale: 'tr' } }, [200], (j) =>
      need(given.every((t) => j.consents.find((c) => c.type === t)?.valid === true), 'granted'),
    );
    await step('consents', 'v1/tenant/consents (withdraw weight)', 'PUT', 'v1/tenant/consents', { ...A, body: { consents: [{ type: 'weight', granted: false, version: CONSENT_VERSION }], source: 'settings', locale: 'tr' } }, [200], (j) => {
      const weight = j.consents.find((c) => c.type === 'weight');
      need(weight.valid === false && weight.withdrawnAt !== null, 'withdrawn');
    });
    await step('consents', 'v1/tenant/consents/history', 'GET', 'v1/tenant/consents/history', A, [200], (j) => need(j.items.length >= given.length + 1, 'append-only history'));
    let profileVersion = profile.json?.version ?? 1;
    void profileVersion;
    await step('profile', 'v1/tenant/style-profile (new user)', 'GET', 'v1/tenant/style-profile', A, [404], () => 'no style profile → onboarding');
    await step('profile', 'v1/tenant/style-profile', 'PUT', 'v1/tenant/style-profile', { ...A, body: { segment: 'women', styleTags: ['minimal', 'quietLuxury', 'officeChic'], budget: 'highStreet', baseVersion: 0 } }, [200], (j) => has(j, 'segment', 'styleTags', 'budget', 'version'));
    await step('profile', 'v1/tenant/style-profile (stale baseVersion)', 'PUT', 'v1/tenant/style-profile', { ...A, body: { segment: 'women', styleTags: ['minimal', 'classic', 'boho'], budget: 'mixed', baseVersion: 0 } }, [409], (j) => {
      has(j, 'version', 'styleTags');
      return '409 body = current record';
    });
    await step('profile', 'v1/tenant/body-profile', 'PUT', 'v1/tenant/body-profile', { ...A, body: { heightCm: 170, weightKg: null, size: 'M', baseVersion: 0 } }, [200], (j) => has(j, 'heightCm', 'size', 'version'));
    await step('profile', 'v1/tenant/body-profile', 'GET', 'v1/tenant/body-profile', A, [200]);
    await step('profile', 'v1/tenant/profile/stats', 'GET', 'v1/tenant/profile/stats', A, [200], (j) => has(j, 'itemCount', 'lookCount', 'tripCount', 'followerCount', 'followingCount'));

    // ----- photos -----
    const up = await step('photos', 'v1/tenant/photo/upload-url', 'POST', 'v1/tenant/photo/upload-url', { ...A, body: { kind: 'body', contentType: 'image/jpeg' } }, [200], (j) => has(j, 'uploadId', 'url', 'fields', 'expiresAt', 'maxBytes'));
    let bodyPhotoId = null;
    if (up.json?.url) {
      const s3 = await postToPresigned(up.json);
      record('photos', 'POST presigned S3 form (fields + file)', s3, s3.status === 204 || s3.status === 201);
      const act = await step('photos', 'v1/tenant/photo/body', 'PUT', 'v1/tenant/photo/body', { ...A, body: { uploadId: up.json.uploadId, clientMutationId: ulid() } }, [200], (j) => has(j, 'id', 'kind', 'url', 'urlExpiresAt'));
      bodyPhotoId = act.json?.id ?? null;
    }
    await step('photos', 'v1/tenant/photo', 'GET', 'v1/tenant/photo', A, [200], (j) => has(j, 'body', 'face'));

    // ----- entitlement -----
    await step('entitlement', 'v1/tenant/entitlement', 'GET', 'v1/tenant/entitlement', A, [200], (j) => {
      has(j, 'tier', 'credits', 'itemRecognition');
      has(j.credits, 'monthlyAllowance', 'allowanceRemaining', 'packRemaining', 'totalRemaining', 'resetsAt');
      return `tier ${j.tier}, recognition ${j.itemRecognition.remaining}/${j.itemRecognition.limit}`;
    });
    await step('entitlement', 'v1/tenant/entitlement/restore', 'POST', 'v1/tenant/entitlement/restore', A, [200, 501], (j, r) => (r.status === 501 ? 'purchase verification not configured (501)' : ''));

    // ----- wardrobe -----
    await step('wardrobe', 'v1/tenant/reference/wardrobe', 'GET', 'v1/tenant/reference/wardrobe', A, [200], (j) => has(j, 'colors', 'fabrics', 'categories', 'seasons', 'occasions', 'tripTypes', 'slots', 'seasonTypes', 'lookMinPieces', 'maxBulkItems'));
    const library = await step('wardrobe', 'v1/tenant/library/item', 'GET', 'v1/tenant/library/item', A, [200], (j) => {
      need(Array.isArray(j) && j.length > 0, 'library is empty');
      has(j[0], 'id', 'name', 'category', 'colorIds', 'imageUrl');
      return `${j.length} pieces`;
    });
    const lib = library.json ?? [];
    const pick = (category) => lib.find((i) => i.category === category)?.id;
    const libIds = [pick('top'), pick('bottom'), pick('shoes'), pick('outerwear')].filter(Boolean);
    const fromLib = await step('wardrobe', 'v1/tenant/item/from-library', 'POST', 'v1/tenant/item/from-library', { ...A, body: { items: libIds.map((libraryItemId) => ({ clientMutationId: ulid(), libraryItemId })) } }, [200], (j) => {
      has(j, 'results', 'createdCount');
      need(j.results.every((r) => r.outcome === 'created' && r.item), 'every row must be created');
      return `${j.createdCount} created`;
    });
    const libItems = (fromLib.json?.results ?? []).map((r) => r.item).filter(Boolean);
    const byCategory = (c) => libItems.find((i) => i.category === c);

    // manual draft: upload → draft (manual: true, no AI, no allowance) → confirm
    const itemUp = await step('wardrobe', 'v1/tenant/item/upload-url', 'POST', 'v1/tenant/item/upload-url', { ...A, body: { count: 1, contentType: 'image/jpeg' } }, [200], (j) => has(j.uploads[0], 'uploadId', 'url', 'fields'));
    let manualItem = null;
    const upload = itemUp.json?.uploads?.[0];
    if (upload) {
      const s3 = await postToPresigned(upload);
      record('wardrobe', 'POST presigned S3 form (garment photo)', s3, s3.status === 204 || s3.status === 201);
      const draft = await step('wardrobe', 'v1/tenant/item-draft (manual)', 'POST', 'v1/tenant/item-draft', { ...A, body: { requestId: ulid(), uploadIds: [upload.uploadId], splitOutfit: false, manual: true } }, [202], (j) => {
        has(j, 'drafts', 'jobs', 'skippedCount', 'itemRecognition');
        need(j.drafts[0].status === 'ready', `manual draft must be ready, got ${j.drafts[0].status}`);
      });
      await step('wardrobe', 'v1/tenant/item-draft', 'GET', 'v1/tenant/item-draft', A, [200], (j) => has(j, 'drafts', 'total', 'processed'));
      const draftId = draft.json?.drafts?.[0]?.id;
      if (draftId) {
        const confirm = await step('wardrobe', 'v1/tenant/item-draft/confirm', 'POST', 'v1/tenant/item-draft/confirm', {
          ...A,
          body: { items: [{ draftId, clientMutationId: ulid(), reviewed: true, name: 'Smoke blazer', category: 'outerwear', colorIds: ['navy'], fabric: 'wool', seasons: ['autumn', 'winter'], size: 'M', brand: null, useOriginalImage: false, itemId: null }] },
        }, [200], (j) => {
          need(j.results[0].outcome === 'created', `outcome ${j.results[0].outcome} ${j.results[0].code ?? ''}`);
        });
        manualItem = confirm.json?.results?.[0]?.item ?? null;
        await branchStep('wardrobe', 'v1/tenant/item-draft/{id}/retry', 'POST', `v1/tenant/item-draft/${draftId}/retry`, A, [202, 404, 409]);
      }
    }
    // Manual piece without a photo (7b) with the formerly lossy fields (7c).
    const manualId = ulid();
    await branchStep('wardrobe', 'v1/tenant/item (manual, no photo)', 'POST', 'v1/tenant/item', {
      ...A, body: { clientMutationId: manualId, itemId: manualId, name: 'Smoke blazer', category: 'outerwear', subcategory: 'blazer', colorIds: ['other'], colorHex: '#123456', fabricText: 'tüvit', seasons: ['autumn'] },
    }, [201], (j) => need(j.item && j.item.imageUrl === null && j.item.source === 'manual' && j.item.subcategory === 'blazer', 'manual item'));
    await branchStep('wardrobe', 'v1/tenant/item (manual, replay)', 'POST', 'v1/tenant/item', {
      ...A, body: { clientMutationId: manualId, itemId: manualId, name: 'Smoke blazer', category: 'outerwear', colorIds: ['other'], seasons: ['autumn'] },
    }, [200], (j) => need(j.outcome === 'alreadyApplied', 'idempotent'));
    await step('wardrobe', 'v1/tenant/item', 'GET', 'v1/tenant/item', A, [200], (j) => {
      need(Array.isArray(j), 'array');
      has(j[0], 'id', 'name', 'category', 'colorIds', 'seasons', 'imageUrl', 'wearCount', 'version');
      return `${j.length} items`;
    });
    const editItem = manualItem ?? libItems[0];
    if (editItem) {
      await step('wardrobe', 'v1/tenant/item/{id}', 'GET', `v1/tenant/item/${editItem.id}`, A, [200], (j) => has(j, 'item', 'looks'));
      const put = { name: 'Smoke piece', category: editItem.category, colorIds: editItem.colorIds, fabric: editItem.fabric, seasons: editItem.seasons, size: 'M', brand: null, useOriginalImage: false };
      await step('wardrobe', 'v1/tenant/item/{id}', 'PUT', `v1/tenant/item/${editItem.id}`, { ...A, body: { ...put, baseVersion: editItem.version } }, [200], (j) => need(j.version === editItem.version + 1, 'version +1'));
      await step('wardrobe', 'v1/tenant/item/{id} (stale baseVersion)', 'PUT', `v1/tenant/item/${editItem.id}`, { ...A, body: { ...put, baseVersion: editItem.version } }, [409], (j) => has(j, 'id', 'version'));
    }

    // ----- looks -----
    const top = byCategory('top');
    const bottom = byCategory('bottom');
    const shoes = byCategory('shoes');
    const lookId = ulid();
    let look = null;
    if (top && bottom) {
      const slots = [{ slot: 'top', itemId: top.id }, { slot: 'bottom', itemId: bottom.id }];
      if (shoes) slots.push({ slot: 'shoes', itemId: shoes.id });
      const created = await step('looks', 'v1/tenant/look', 'POST', 'v1/tenant/look', { ...A, body: { id: lookId, name: 'Smoke ofis', occasion: 'office', slots, favorite: false, source: 'user' } }, [201], (j) => has(j, 'id', 'slots', 'pieceCount', 'favorite', 'source', 'version', 'rating'));
      look = created.json;
      await step('looks', 'v1/tenant/look (same id again)', 'POST', 'v1/tenant/look', { ...A, body: { id: lookId, name: 'Smoke ofis', occasion: 'office', slots, favorite: false, source: 'user' } }, [200]);
      await step('looks', 'v1/tenant/look', 'GET', 'v1/tenant/look', A, [200], (j) => need(j.some((l) => l.id === lookId), 'look in list'));
      if (look) {
        const fav = await step('looks', 'v1/tenant/look/{id} (favorite toggle)', 'PUT', `v1/tenant/look/${lookId}`, { ...A, body: { name: look.name, occasion: look.occasion, slots, favorite: true, baseVersion: look.version } }, [200], (j) => need(j.favorite === true, 'favorite'));
        await step('looks', 'v1/tenant/look/{id} (stale baseVersion)', 'PUT', `v1/tenant/look/${lookId}`, { ...A, body: { name: look.name, occasion: look.occasion, slots, favorite: false, baseVersion: look.version } }, [409], (j) => has(j, 'id', 'version'));
        look = fav.json ?? look;
      }
      await step('looks', 'v1/tenant/look (one piece)', 'POST', 'v1/tenant/look', { ...A, body: { id: ulid(), name: 'Tek', occasion: 'office', slots: [slots[0]], favorite: false, source: 'user' } }, [422], (j) => need(j.code === 'look_min_pieces', 'code'));
    } else {
      record('looks', 'POST v1/tenant/look', null, false, 'no top + bottom in the library to build a look');
    }

    // ----- today / plan / wear log / calendar -----
    await step('today', 'v1/tenant/today', 'GET', `v1/tenant/today?date=${today}`, A, [200], (j) => {
      has(j, 'date', 'season', 'weather', 'occasion', 'plan', 'look', 'hasMissingPieces', 'missingPieces', 'worn', 'week');
      need(j.week.length === 7, 'week has 7 days');
    });
    if (look) {
      const plan = await step('plan', 'v1/tenant/plan-day/{date}', 'PUT', `v1/tenant/plan-day/${today}`, { ...A, body: { occasion: 'office', lookId, baseVersion: 0 } }, [200], (j) => has(j, 'date', 'occasion', 'lookId', 'look', 'worn', 'version'));
      await step('plan', 'v1/tenant/plan-day/{date} (stale baseVersion)', 'PUT', `v1/tenant/plan-day/${today}`, { ...A, body: { occasion: 'dinner', lookId, baseVersion: 0 } }, [409], (j) => has(j, 'date', 'version'));
      await step('plan', 'v1/tenant/plan-day', 'GET', `v1/tenant/plan-day?from=${today}&to=${isoDate(addDays(6))}`, A, [200], (j) => need(j.some((d) => d.date === today), 'planned day in range'));
      await step('today', 'v1/tenant/today (planned)', 'GET', `v1/tenant/today?date=${today}`, A, [200], (j) => need(j.look && j.look.id === lookId, 'today shows the planned look'));
      const wearId = ulid();
      await step('wear-log', 'v1/tenant/wear-log', 'POST', 'v1/tenant/wear-log', { ...A, body: { clientMutationId: wearId, date: today, occurredAt: new Date().toISOString(), lookId } }, [200], (j) => {
        has(j, 'log', 'items');
        need(j.log.id === wearId, 'log id = clientMutationId');
      });
      const month = today.slice(0, 7);
      await step('calendar', 'v1/tenant/wear-log?month=', 'GET', `v1/tenant/wear-log?month=${month}`, A, [200], (j) => need(j.some((l) => l.id === wearId), 'log in month'));
      await step('calendar', 'v1/tenant/wear-log/summary', 'GET', `v1/tenant/wear-log/summary?month=${month}`, A, [200], (j) => {
        has(j, 'month', 'loggedDays', 'totalWears', 'mostWorn');
        return `${j.loggedDays} day(s), ${j.totalWears} wears`;
      });
      await step('wear-log', 'v1/tenant/wear-log/{date}/{id}', 'DELETE', `v1/tenant/wear-log/${today}/${wearId}`, A, [204]);
      void plan;
    }

    // ----- weather / city -----
    const cities = await step('weather', 'v1/weather/city', 'GET', 'v1/weather/city?q=istanbul', A, [200, 503], (j, r) => {
      if (r.status === 503) return 'weather provider unavailable';
      need(Array.isArray(j) && j.length > 0, 'no city');
      has(j[0], 'id', 'name', 'region', 'country', 'countryCode', 'latitude', 'longitude', 'timeZone');
      return j[0].name;
    });
    const city = Array.isArray(cities.json) ? cities.json[0] : null;
    if (city) {
      await step('weather', 'v1/weather?cityId=', 'GET', `v1/weather?cityId=${encodeURIComponent(city.id)}&days=3`, A, [200, 503], (j, r) => {
        if (r.status === 503) return 'weather provider unavailable';
        has(j, 'locationKey', 'city', 'fetchedAt', 'days');
        has(j.days[0], 'date', 'minC', 'maxC', 'condition');
      });
      const p = await step('settings', 'v1/tenant/profile (cityId)', 'PUT', 'v1/tenant/profile', { ...A, body: { cityId: city.id, baseVersion: await profileVersionOf(A) } }, [200], (j) => need(j.cityId === city.id, 'cityId saved'));
      profileVersion = p.json?.version ?? profileVersion;
    }
    await step('weather', 'v1/weather (no city, no coordinates)', 'GET', 'v1/weather', A, [400], () => 'cityId or lat/lon is required');

    // ----- trips -----
    const tripId = ulid();
    const tripBody = { cityId: city?.id ?? '745044', cityName: city?.name ?? 'İstanbul', startDate: isoDate(addDays(10)), endDate: isoDate(addDays(12)), tripTypes: ['business', 'dinner'], cabinOnly: true };
    const trip = await step('trips', 'v1/tenant/trip', 'POST', 'v1/tenant/trip', { ...A, body: { id: tripId, ...tripBody } }, [201], (j) => has(j, 'id', 'cityId', 'cityName', 'startDate', 'endDate', 'tripTypes', 'cabinOnly', 'status', 'archived', 'dayCount', 'itemCount', 'packedCount', 'missing', 'version'));
    if (trip.json) {
      await step('trips', 'v1/tenant/trip', 'GET', 'v1/tenant/trip', A, [200], (j) => need(j.some((t) => t.id === tripId), 'trip in list'));
      await step('trips', 'v1/tenant/trip/{id}', 'GET', `v1/tenant/trip/${tripId}`, A, [200], (j) => has(j, 'trip', 'items', 'days'));
      await step('trips', 'v1/tenant/trip/{id}', 'PUT', `v1/tenant/trip/${tripId}`, { ...A, body: { ...tripBody, cabinOnly: false, baseVersion: trip.json.version } }, [200], (j) => need(j.cabinOnly === false, 'cabinOnly'));
      await step('trips', 'v1/tenant/trip/{id}/pack (free user)', 'POST', `v1/tenant/trip/${tripId}/pack`, { ...A, body: { requestId: ulid() } }, [202, 403], (j, r) => (r.status === 403 ? `403 ${j.code} → paywall` : `job ${j.id} ${j.status}`));
      await step('trips', 'v1/tenant/trip/{id}/archive', 'POST', `v1/tenant/trip/${tripId}/archive`, A, [200], (j) => need(j.archived === true, 'archived'));
      await step('trips', 'v1/tenant/trip/{id}/archive', 'DELETE', `v1/tenant/trip/${tripId}/archive`, A, [200], (j) => need(j.archived === false, 'unarchived'));
    }

    // ----- AI jobs -----
    const jobRequestId = ulid();
    const outfit = await step('stylist', 'v1/tenant/stylist/outfit', 'POST', 'v1/tenant/stylist/outfit', { ...A, body: { requestId: jobRequestId, date: today, occasion: 'office', freeText: null, onlyMyWardrobe: true, pinnedItemId: null, cityId: city?.id ?? null, latitude: null, longitude: null } }, [202, 403], (j, r) =>
      r.status === 403 ? `403 ${j.code} → paywall (free account; no job started)` : `job ${j.id} ${j.status}`,
    );
    if (outfit.status === 202 && outfit.json?.id) {
      // One job, polled with the app's back-off for at most ~60 s; reported honestly, never retried.
      let job = outfit.json;
      const waits = [1000, 2000, 4000, 8000, 10000, 10000, 10000, 10000];
      for (const wait of waits) {
        if (job.status === 'completed' || job.status === 'failed') break;
        await new Promise((r) => setTimeout(r, wait));
        const polled = await call('GET', `v1/tenant/job/${outfit.json.id}`, A);
        if (polled.json) job = polled.json;
      }
      const terminal = job.status === 'completed' || job.status === 'failed';
      record('stylist', 'GET v1/tenant/job/{id} (stylist outfit)', { status: 200, json: null }, terminal ? (job.status === 'completed') : 'skip',
        job.status === 'completed' ? `completed · ${job.result?.suggestions?.length ?? 0} suggestion(s), refusal ${job.result?.refusal ?? 'none'}` : `status ${job.status} · failure ${job.failure ?? 'none'}`);
    }
    await step('stylist', 'v1/tenant/stylist/week', 'POST', 'v1/tenant/stylist/week', { ...A, body: { requestId: ulid(), weekStart: isoDate(mondayOf()), onlyMyWardrobe: true } }, [202, 403], (j, r) => (r.status === 403 ? `403 ${j.code} → paywall` : `job ${j.status}`));
    await step('try-on', 'v1/tenant/tryon', 'POST', 'v1/tenant/tryon', { ...A, body: { requestId: ulid(), target: { kind: 'look', id: lookId, index: null } } }, [200, 202, 402, 403, 422], (j, r) => (r.status >= 400 ? `${r.status} ${j.code}` : j.status));
    await step('try-on', 'v1/tenant/tryon?kind=&id=', 'GET', `v1/tenant/tryon?kind=look&id=${lookId}`, A, [200, 404], (j, r) => (r.status === 404 ? 'no image yet' : 'image'));
    await step('try-on', 'v1/tenant/tryon/plan-week/quote', 'POST', 'v1/tenant/tryon/plan-week/quote', { ...A, body: { weekStart: isoDate(mondayOf()) } }, [200, 403, 422], (j, r) => (r.status === 200 ? `${j.requiredCredits} credit(s) required` : `${r.status} ${j.code}`));

    // ----- palette -----
    await step('palette', 'v1/tenant/palette', 'GET', 'v1/tenant/palette', A, [404], (j) => need(j.code === 'palette_not_found', 'code'));
    await step('palette', 'v1/tenant/palette/analyze', 'POST', 'v1/tenant/palette/analyze', { ...A, body: { requestId: ulid() } }, [200, 202, 403, 422], (j, r) => (r.status >= 400 ? `${r.status} ${j.code}` : j.status));

    // ----- catalog / content (dev catalog is not seeded) -----
    await step('catalog', 'v1/catalog/brand', 'GET', 'v1/catalog/brand', A, [200], (j) => `${j.length} brand(s)`);
    const products = await step('catalog', 'v1/catalog/product', 'GET', 'v1/catalog/product?sort=newest&limit=24', A, [200], (j) => {
      has(j, 'items', 'pageToken', 'count');
      return `${j.count} product(s)`;
    });
    const product = products.json?.items?.[0] ?? null;
    await step('catalog', 'v1/catalog/product/{id} (unknown)', 'GET', 'v1/catalog/product/smoke-unknown', A, [404], (j) => need(j.code === 'product_not_found', 'code'));
    await step('content', 'v1/content/edit/current', 'GET', 'v1/content/edit/current', A, [200, 404], (j, r) => (r.status === 404 ? 'no published edit' : j.id));
    await step('content', 'v1/content/creator', 'GET', 'v1/content/creator', A, [200], (j) => `${j.length} collection(s)`);
    await step('content', 'v1/content/series-outfit', 'GET', 'v1/content/series-outfit', A, [200], (j) => `${j.length} collection(s)`);
    if (libItems.length > 0) {
      await step('catalog', 'v1/tenant/catalog/complete', 'POST', 'v1/tenant/catalog/complete', { ...A, body: { itemIds: [libItems[0].id] } }, [200], (j) => {
        has(j, 'slots');
        return `${j.slots.length} slot(s)`;
      });
    }

    // ----- cart / watch list / favourites -----
    await step('cart', 'v1/tenant/cart', 'GET', 'v1/tenant/cart', A, [200], (j) => has(j, 'groups', 'lineCount', 'totalMinor', 'currency'));
    if (product) {
      const size = product.sizes[0];
      const cart = await step('cart', 'v1/tenant/cart/line', 'POST', 'v1/tenant/cart/line', { ...A, body: { lines: [{ clientMutationId: ulid(), productId: product.id, ...(size ? { size } : {}) }] } }, [200], (j) => need(j.lineCount === 1, 'one line'));
      const lineId = cart.json?.groups?.[0]?.lines?.[0]?.lineId;
      await step('cart', 'v1/tenant/cart/checkout/{brandId}', 'POST', `v1/tenant/cart/checkout/${product.brandId}`, A, [200, 422], (j, r) => (r.status === 422 ? j.code : 'checkout url'));
      if (lineId) await step('cart', 'v1/tenant/cart/line/{lineId}', 'DELETE', `v1/tenant/cart/line/${lineId}`, A, [204]);
      await step('watch list', 'v1/tenant/watch-list/{productId}', 'PUT', `v1/tenant/watch-list/${product.id}`, { ...A, body: {} }, [200], (j) => has(j, 'product', 'priceAtAddMinor', 'currentPriceMinor', 'priceDropped'));
      await step('watch list', 'v1/tenant/watch-list/{productId} (bell off)', 'PUT', `v1/tenant/watch-list/${product.id}`, { ...A, body: { notify: false } }, [200], (j) =>
        'notify' in j ? need(j.notify === false && j.origin === 'user', 'bell off') : 'older deployment (no notify)');
      await step('watch list', 'v1/tenant/watch-list/{productId}', 'DELETE', `v1/tenant/watch-list/${product.id}`, A, [204]);
    } else {
      await step('cart', 'v1/tenant/cart/line (unknown product; catalog empty)', 'POST', 'v1/tenant/cart/line', { ...A, body: { lines: [{ clientMutationId: ulid(), productId: 'smoke-unknown' }] } }, [404], (j) => need(j.code === 'product_not_found', 'code'));
      await step('watch list', 'v1/tenant/watch-list/{productId} (unknown product; catalog empty)', 'PUT', 'v1/tenant/watch-list/smoke-unknown', { ...A, body: {} }, [404], (j) => need(j.code === 'product_not_found', 'code'));
    }
    await step('watch list', 'v1/tenant/watch-list', 'GET', 'v1/tenant/watch-list', A, [200], (j) => need(Array.isArray(j), 'array'));
    await step('cart', 'v1/tenant/purchase-prompt', 'GET', 'v1/tenant/purchase-prompt', A, [200], (j) => need(Array.isArray(j), 'array'));
    await branchStep('favourites', 'v1/tenant/favorite/product', 'GET', 'v1/tenant/favorite/product', A, [200], (j) => has(j, 'productIds'));

    // ----- social (second user) -----
    const handleA = `smokea${String(STAMP).slice(-9)}`;
    const handleB = `smokeb${String(STAMP).slice(-9)}`;
    const hA = await step('social', 'v1/tenant/profile/handle (a)', 'PUT', 'v1/tenant/profile/handle', { ...A, body: { handle: handleA } }, [200], (j) => need(j.handle === handleA, 'handle'));
    profileVersion = hA.json?.version ?? profileVersion;
    await step('social', 'v1/tenant/profile/handle (b)', 'PUT', 'v1/tenant/profile/handle', { ...B, body: { handle: handleB } }, [200]);
    await step('social', 'v1/tenant/profile/handle (taken)', 'PUT', 'v1/tenant/profile/handle', { ...B, body: { handle: handleA } }, [409], (j) => need(j.code === 'handle_taken', 'code'));
    const vis = await step('settings', 'v1/tenant/profile/visibility', 'PUT', 'v1/tenant/profile/visibility', { ...A, body: { closetVisibility: 'public', baseVersion: await profileVersionOf(A) } }, [200], (j) => need(j.closetVisibility === 'public', 'visibility'));
    profileVersion = vis.json?.version ?? profileVersion;
    await step('settings', 'v1/tenant/profile/visibility (stale baseVersion)', 'PUT', 'v1/tenant/profile/visibility', { ...A, body: { closetVisibility: 'private', baseVersion: Math.max(1, (vis.json?.version ?? 2) - 1) } }, [409], (j) => has(j, 'closetVisibility', 'version'));
    await step('social', 'v1/tenant/people?q=', 'GET', `v1/tenant/people?q=${handleA.slice(0, 8)}`, B, [200], (j) => {
      need(j.some((p) => p.handle === handleA), 'user a found by handle prefix');
      has(j[0], 'handle', 'displayName', 'styleTags', 'styleMatchPercent', 'isFollowing', 'followsYou');
    });
    await step('social', 'v1/tenant/people/suggested', 'GET', 'v1/tenant/people/suggested', B, [200], (j) => need(Array.isArray(j), 'array'));
    await step('social', 'v1/tenant/people/{handle}', 'GET', `v1/tenant/people/${handleA}`, B, [200], (j) => has(j, 'handle', 'displayName', 'isSelf', 'isFollowing', 'closetVisibility', 'closetLocked', 'itemCount', 'lookCount', 'followerCount', 'followingCount'));
    // a is public → the follow is immediate (200 { state } since decision 8; 204 on an older deployment).
    await step('social', 'v1/tenant/follow/{handle} (public → following)', 'POST', `v1/tenant/follow/${handleA}`, B, [200, 204], (j, r) =>
      r.status === 204 ? 'older deployment (204)' : need(j.state === 'following', 'state following'));
    await step('social', 'v1/tenant/following', 'GET', 'v1/tenant/following', B, [200], (j) => need(j.some((p) => p.handle === handleA), 'following a'));
    await step('social', 'v1/tenant/follower', 'GET', 'v1/tenant/follower', A, [200], (j) => {
      need(Array.isArray(j), 'array');
      return `${j.length} visible follower(s)`;
    });
    // b is followers-only (the default of a new account, decision 7) → a's follow is a request b approves (decision 8).
    const asked = await step('follow requests', 'v1/tenant/follow/{handle} (followers-only → requested)', 'POST', `v1/tenant/follow/${handleB}`, A, [200, 204, 404], (j, r) =>
      r.status === 200 ? need(j.state === 'requested' || j.state === 'following', 'state') && `state ${j.state}` : 'older deployment (b private by default)');
    if (asked.json?.state === 'requested') {
      await branchStep('follow requests', 'v1/tenant/follow-request/outgoing', 'GET', 'v1/tenant/follow-request/outgoing', A, [200], (j) => need(j.some((r) => r.person.handle === handleB), 'request listed'));
      await branchStep('follow requests', 'v1/tenant/follow-request/incoming', 'GET', 'v1/tenant/follow-request/incoming', B, [200], (j) => {
        need(j.some((r) => r.person.handle === handleA), 'request listed');
        has(j[0], 'person', 'createdAt');
      });
      await branchStep('follow requests', 'v1/tenant/people/{handle} (pending)', 'GET', `v1/tenant/people/${handleB}`, A, [200], (j) => need(j.followState === 'requested' && j.closetLocked === true, 'pending is not following'));
      await branchStep('follow requests', 'v1/tenant/follow-request/{handle}/approve', 'POST', `v1/tenant/follow-request/${handleA}/approve`, B, [204]);
      await branchStep('follow requests', 'v1/tenant/follow-request/{handle}/approve (again)', 'POST', `v1/tenant/follow-request/${handleA}/approve`, B, [404]);
      await branchStep('follow requests', 'v1/tenant/follower/{handle}', 'DELETE', `v1/tenant/follower/${handleA}`, B, [204]);
      await branchStep('follow requests', 'v1/tenant/follow/{handle} (ask again)', 'POST', `v1/tenant/follow/${handleB}`, A, [200], (j) => need(j.state === 'requested', 'requested'));
      await branchStep('follow requests', 'v1/tenant/follow-request/{handle}/decline', 'POST', `v1/tenant/follow-request/${handleA}/decline`, B, [204]);
      await branchStep('follow requests', 'v1/tenant/follow/{handle} (ask a third time)', 'POST', `v1/tenant/follow/${handleB}`, A, [200]);
      await branchStep('follow requests', 'v1/tenant/follow-request/{handle} (cancel)', 'DELETE', `v1/tenant/follow-request/${handleB}`, A, [204]);
    }
    await branchStep('profile', 'v1/tenant/profile/handle/availability (taken)', 'GET', `v1/tenant/profile/handle/availability?handle=${handleB}`, A, [200], (j) => need(j.available === false && j.code === 'handle_taken', 'taken'));
    await branchStep('profile', 'v1/tenant/profile/handle/availability (own)', 'GET', `v1/tenant/profile/handle/availability?handle=${handleA}`, A, [200], (j) => need(j.available === true, 'own handle'));
    await branchStep('profile', 'v1/tenant/profile/handle/availability (reserved)', 'GET', 'v1/tenant/profile/handle/availability?handle=admin', A, [200], (j) => need(j.code === 'handle_reserved', 'reserved'));
    // Contact matching (decision 13): hashes only; smoke users have unverified e-mails, so no match is expected.
    const salt = await branchStep('contacts', 'v1/tenant/contacts/salt', 'POST', 'v1/tenant/contacts/salt', A, [200], (j) => has(j, 'saltId', 'salt', 'prefixLength', 'maxHashes', 'expiresAt'));
    if (salt.json?.salt) {
      const sha = (v) => createHash('sha256').update(v, 'utf8').digest('hex');
      const hashes = [b.email, 'nobody@example.com'].map((e) => {
        const h0 = sha(e.trim().toLowerCase());
        return { p: h0.slice(0, salt.json.prefixLength), h: sha(`${salt.json.salt}:email:${h0}`) };
      });
      await branchStep('contacts', 'v1/tenant/contacts/match', 'POST', 'v1/tenant/contacts/match', { ...A, body: { saltId: salt.json.saltId, hashes } }, [200], (j) => {
        need(Array.isArray(j.matches), 'matches');
        return `${j.matches.length} match(es)`;
      });
      await branchStep('contacts', 'v1/tenant/contacts/match (salt reused)', 'POST', 'v1/tenant/contacts/match', { ...A, body: { saltId: salt.json.saltId, hashes } }, [404], (j) => need(j.code === 'contact_salt_not_found', 'single use'));
    }
    await step('social', 'v1/tenant/feed', 'GET', 'v1/tenant/feed', B, [200], (j) => {
      has(j, 'items', 'pageToken');
      if (look) {
        const item = j.items.find((l) => l.id === lookId);
        need(item, "a's look is in b's feed");
        has(item, 'ownerHandle', 'ownerDisplayName', 'name', 'occasion', 'pieces', 'rating', 'saved');
      }
      return `${j.items.length} look(s)`;
    });
    await step('social', 'v1/tenant/people/{handle}/look', 'GET', `v1/tenant/people/${handleA}/look`, B, [200]);
    await step('social', 'v1/tenant/people/{handle}/item', 'GET', `v1/tenant/people/${handleA}/item`, B, [200]);
    if (look) {
      await step('social', 'v1/tenant/people/{handle}/look/{id}/rating', 'PUT', `v1/tenant/people/${handleA}/look/${lookId}/rating`, { ...B, body: { score: 4, clientMutationId: ulid() } }, [200], (j) => need(j.myScore === 4 && j.count === 1, 'rating recorded'));
      await step('social', 'v1/tenant/people/{handle}/look/{id}/save', 'PUT', `v1/tenant/people/${handleA}/look/${lookId}/save`, B, [204]);
      await step('social', 'v1/tenant/saved-look', 'GET', 'v1/tenant/saved-look', B, [200], (j) => need(j.some((l) => l.id === lookId), 'saved look listed'));
      await step('social', 'v1/tenant/people/{handle}/look/{id}/save', 'DELETE', `v1/tenant/people/${handleA}/look/${lookId}/save`, B, [204]);
      await step('looks', "v1/tenant/look/{id} (owner sees friends' rating)", 'GET', `v1/tenant/look/${lookId}`, A, [200], (j) => need(j.rating && j.rating.count === 1, 'rating on the owner look'));
    }
    await step('social', 'v1/tenant/people/{handle}/report', 'POST', `v1/tenant/people/${handleA}/report`, { ...B, body: { targetKind: 'profile', reason: 'spam' } }, [201], (j) => has(j, 'reportId'));
    const invite = await step('invite', 'v1/tenant/invite/link', 'GET', 'v1/tenant/invite/link', A, [200], (j) => has(j, 'code', 'url', 'invitedCount'));
    if (invite.json?.code) {
      await step('invite', 'v1/invite/{code} (anonymous)', 'GET', `v1/invite/${invite.json.code}`, {}, [200], (j) => has(j, 'code', 'inviterFirstName'));
      await step('invite', 'v1/tenant/invite/attribution', 'POST', 'v1/tenant/invite/attribution', { ...B, body: { code: invite.json.code } }, [204]);
      await step('invite', 'v1/tenant/invite/attribution (again)', 'POST', 'v1/tenant/invite/attribution', { ...B, body: { code: invite.json.code } }, [409], (j) => need(j.code === 'invite_already_attributed', 'code'));
    }
    await step('share', 'v1/tenant/share', 'POST', 'v1/tenant/share', { ...A, body: { clientMutationId: ulid(), channel: 'link', targetKind: 'look', targetId: lookId, ownerHandle: handleA } }, [200, 201], (j) => has(j, 'shareId', 'inviteCode', 'url', 'channel'));
    await step('social', 'v1/tenant/follow/{handle}', 'DELETE', `v1/tenant/follow/${handleA}`, B, [204]);
    await step('social', 'v1/tenant/block/{handle}', 'PUT', `v1/tenant/block/${handleA}`, B, [204]);
    await step('social', 'v1/tenant/people/{handle} (blocked)', 'GET', `v1/tenant/people/${handleA}`, B, [404]);
    await step('social', 'v1/tenant/block', 'GET', 'v1/tenant/block', B, [200], (j) => need(j.some((p) => p.handle === handleA), 'blocked listed'));
    await step('social', 'v1/tenant/block/{handle}', 'DELETE', `v1/tenant/block/${handleA}`, B, [204]);

    // ----- settings / notifications / devices -----
    const settings = await step('settings', 'v1/tenant/settings', 'GET', 'v1/tenant/settings', A, [200], (j) => has(j, 'closetVisibility', 'language', 'cityId', 'city', 'notifications', 'devices', 'profileVersion'));
    profileVersion = settings.json?.profileVersion ?? profileVersion;
    await step('settings', 'v1/tenant/profile (language)', 'PUT', 'v1/tenant/profile', { ...A, body: { language: 'en', baseVersion: settings.json?.profileVersion ?? (await profileVersionOf(A)) } }, [200], (j) => need(j.language === 'en', 'language saved'));
    const prefs = await step('notifications', 'v1/tenant/user/me/notifications', 'GET', 'v1/tenant/user/me/notifications', A, [200], (j) => has(j, 'morningOutfit', 'morningOutfitLocalTime', 'weeklyEdit', 'friendRatings', 'timeZone', 'version'));
    const prefsBody = { morningOutfit: true, morningOutfitLocalTime: '07:30', weeklyEdit: false, friendRatings: false, timeZone: 'Europe/Istanbul' };
    // The weekly edit / price drops are marketing (explicit consent 5): refused until the consent is recorded.
    await step('notifications', 'v1/tenant/user/me/notifications (weekly edit, no consent)', 'PUT', 'v1/tenant/user/me/notifications', { ...A, body: { ...prefsBody, weeklyEdit: true, baseVersion: prefs.json?.version ?? 0 } }, [403], (j) =>
      need(j.code === 'consent_required' && j.missing.includes('marketingNotifications'), 'marketing consent'),
    );
    await step('notifications', 'v1/tenant/user/me/notifications', 'PUT', 'v1/tenant/user/me/notifications', { ...A, body: { ...prefsBody, baseVersion: prefs.json?.version ?? 0 } }, [200], (j) => need(j.morningOutfit === true, 'saved'));
    await step('consents', 'v1/tenant/consents (marketing)', 'PUT', 'v1/tenant/consents', { ...A, body: { consents: [{ type: 'marketingNotifications', granted: true, version: '2026-11-19' }], source: 'notifications', locale: 'tr' } }, [200]);
    const weekly = await step('notifications', 'v1/tenant/user/me/notifications (weekly edit, consented)', 'PUT', 'v1/tenant/user/me/notifications', { ...A, body: { ...prefsBody, weeklyEdit: true, baseVersion: (prefs.json?.version ?? 0) + 1 } }, [200], (j) => need(j.weeklyEdit === true, 'weekly edit on'));
    await step('consents', 'v1/tenant/consents (withdraw marketing)', 'PUT', 'v1/tenant/consents', { ...A, body: { consents: [{ type: 'marketingNotifications', granted: false, version: '2026-11-19' }], source: 'settings', locale: 'tr' } }, [200]);
    await step('notifications', 'v1/tenant/user/me/notifications (after withdrawal)', 'GET', 'v1/tenant/user/me/notifications', A, [200], (j) => need(j.weeklyEdit === false, 'withdrawal switched the weekly edit off'));
    void weekly;

    // ----- notification inbox -----
    const inbox = await step('inbox', 'v1/tenant/notification', 'GET', 'v1/tenant/notification?limit=30', A, [200], (j) => {
      has(j, 'items', 'pageToken', 'unreadCount');
      return `${j.items.length} item(s), ${j.unreadCount} unread`;
    });
    await step('inbox', 'v1/tenant/notification (B: follow request events)', 'GET', 'v1/tenant/notification', B, [200], (j) => `${j.items.length} item(s): ${[...new Set(j.items.map((n) => n.type))].join(', ') || 'none'}`);
    const firstId = inbox.json?.items?.[0]?.id;
    if (firstId) await step('inbox', 'v1/tenant/notification/read (one)', 'POST', 'v1/tenant/notification/read', { ...A, body: { ids: [firstId] } }, [200], (j) => has(j, 'unreadCount'));
    await step('inbox', 'v1/tenant/notification/read (all)', 'POST', 'v1/tenant/notification/read', { ...A, body: { ids: null } }, [200], (j) => need(j.unreadCount === 0, 'all read'));

    // ----- profile photo (avatar): its own storage, never the body / face photos -----
    const avatarUp = await step('avatar', 'v1/tenant/profile/avatar/upload-url', 'POST', 'v1/tenant/profile/avatar/upload-url', { ...A, body: { contentType: 'image/jpeg' } }, [200], (j) => has(j, 'uploadId', 'url', 'fields', 'expiresAt', 'maxBytes'));
    if (avatarUp.json?.url) {
      const s3 = await postToPresigned(avatarUp.json);
      record('avatar', 'POST presigned S3 form (avatar)', s3, s3.status === 204 || s3.status === 201);
      await step('avatar', 'v1/tenant/profile/avatar', 'PUT', 'v1/tenant/profile/avatar', { ...A, body: { uploadId: avatarUp.json.uploadId, clientMutationId: ulid() } }, [200], (j) => need(typeof j.avatarUrl === 'string', 'avatarUrl'));
      await step('avatar', 'v1/tenant/photo (avatar is not a body / face photo)', 'GET', 'v1/tenant/photo', A, [200], (j) => need(!JSON.stringify(j).includes(avatarUp.json.uploadId), 'separate'));
      await step('avatar', 'v1/tenant/profile/avatar', 'DELETE', 'v1/tenant/profile/avatar', A, [204]);
      await step('avatar', 'v1/tenant/profile (photo removed)', 'GET', 'v1/tenant/profile', A, [200], (j) => need(j.avatarUrl === null, 'no avatar'));
    }
    await step('notifications', 'v1/tenant/user/me/notifications (07:10)', 'PUT', 'v1/tenant/user/me/notifications', { ...A, body: { ...prefsBody, morningOutfitLocalTime: '07:10', baseVersion: (prefs.json?.version ?? 0) + 1 } }, [400], (j) => need(j.code === 'validation_failed', 'code'));
    const deviceId = `smoke-device-${STAMP}`;
    await step('devices', 'v1/tenant/user/me/device', 'PUT', 'v1/tenant/user/me/device', { ...A, body: { deviceId, platform: 'ios', timeZone: 'Europe/Istanbul' } }, [200], (j) => has(j, 'deviceId', 'platform', 'pushEnabled', 'updatedAt'));
    await step('devices', 'v1/tenant/user/me/device/{deviceId}', 'DELETE', `v1/tenant/user/me/device/${deviceId}`, A, [204]);

    // ----- analytics events -----
    await step('events', 'v1/tenant/event', 'POST', 'v1/tenant/event', {
      ...A,
      body: {
        platform: 'ios',
        appVersion: '0.1.0',
        events: [
          { name: 'signup_completed', occurredAt: new Date().toISOString(), props: { source: 'email' } },
          { name: 'paywall_viewed', occurredAt: new Date().toISOString(), props: { source: 'onboarding' } },
          { name: 'add_to_cart', props: {} },
        ],
      },
    }, [200], (j) => {
      need(j.accepted === 2, `accepted ${j.accepted}`);
      need(j.rejected.length === 1 && j.rejected[0].code === 'name_server_only', 'server-only event rejected');
      return '2 accepted, 1 rejected (server-only name)';
    });

    // ----- cleanup of single records -----
    if (bodyPhotoId) await branchStep('photos', 'v1/tenant/photo/{kind}/{photoId}', 'DELETE', `v1/tenant/photo/body/${bodyPhotoId}`, A, [204]);
    await step('photos', 'v1/tenant/photo (delete all)', 'DELETE', 'v1/tenant/photo', A, [204]);
    if (look) {
      await step('plan', 'v1/tenant/plan-day/{date}', 'DELETE', `v1/tenant/plan-day/${today}`, A, [204]);
      await step('looks', 'v1/tenant/look/{id}', 'DELETE', `v1/tenant/look/${lookId}`, A, [204]);
    }
    if (trip.json) await step('trips', 'v1/tenant/trip/{id}', 'DELETE', `v1/tenant/trip/${tripId}`, A, [204]);
    if (editItem) await step('wardrobe', 'v1/tenant/item/{id}', 'DELETE', `v1/tenant/item/${editItem.id}`, A, [204]);
  } catch (e) {
    record('script', 'unexpected error', null, false, String(e?.stack ?? e).slice(0, 300));
  } finally {
    // The smoke users are always removed, whatever happened above.
    await step('cleanup', 'v1/auth/me (a)', 'DELETE', 'v1/auth/me', A, [204]);
    await step('cleanup', 'v1/auth/me (b)', 'DELETE', 'v1/auth/me', B, [204]);
    await step('cleanup', 'v1/auth/login (deleted account)', 'POST', 'v1/auth/login', { body: { email: a.email, password: PASSWORD } }, [401]);
  }

  print();
  process.exit(failed > 0 ? 1 : 0);
}

function print() {
  const w = { feature: 13, step: 62, status: 6, result: 6 };
  const line = (r) => `${r.feature.padEnd(w.feature)} ${r.step.padEnd(w.step)} ${r.status.padEnd(w.status)} ${r.result.padEnd(w.result)} ${r.note}`;
  console.log(line({ feature: 'FEATURE', step: 'STEP', status: 'HTTP', result: 'RESULT', note: 'NOTE' }));
  console.log('-'.repeat(110));
  rows.forEach((r) => console.log(line(r)));
  const count = (x) => rows.filter((r) => r.result === x).length;
  console.log('-'.repeat(110));
  console.log(`${rows.length} steps · ${count('PASS')} passed · ${count('FAIL')} failed · ${count('SKIP')} skipped`);
}

await main();
