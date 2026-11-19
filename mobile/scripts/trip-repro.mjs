#!/usr/bin/env node
/**
 * Trip detail (19 Bavul detayı) reproduction against the real API — the exact calls the app makes for a new
 * trip: city search → create trip → trip detail (embedded forecast) → GET v1/weather → pack job → poll.
 * Node 20+, no dependencies.
 *
 *   node scripts/trip-repro.mjs                          # dev API, London, +6…+10 days
 *   TRIP_CITY=Paris TRIP_START_IN=6 TRIP_DAYS=5 node scripts/trip-repro.mjs
 *   DROBLET_API_BASE_URL=https://… node scripts/trip-repro.mjs
 *
 * Registers a fresh `trip+<timestamp>@example.com` user (deleted at the end), prints every status + body
 * (bodies trimmed) and a summary table.
 */
const BASE = (process.env.DROBLET_API_BASE_URL ?? 'https://b8lvaj4r5e.execute-api.eu-central-1.amazonaws.com').replace(/\/+$/, '');
const CITY = process.env.TRIP_CITY ?? 'London';
const START_IN = Number(process.env.TRIP_START_IN ?? 6);
const DAYS = Number(process.env.TRIP_DAYS ?? 5);
const LANGUAGE = process.env.TRIP_LANGUAGE ?? 'en-US';
const STAMP = Date.now();

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
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
};

const rows = [];
async function call(label, method, path, { body, token } = {}) {
  const headers = { Accept: 'application/json', 'Accept-Language': LANGUAGE };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let status = 0;
  let text = '';
  try {
    const res = await fetch(`${BASE}/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    status = res.status;
    text = await res.text();
  } catch (e) {
    text = String(e);
  }
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  console.log(`\n${method} ${path} → ${status}\n${text.slice(0, 1200)}`);
  return { label, status, json, text };
}
function record(label, res, note) {
  rows.push({ step: label, status: res ? res.status : '-', note });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Trip repro — ${BASE} · ${CITY} · start +${START_IN}d · ${DAYS} days · ${new Date().toISOString()}`);
  // TRIP_EMAIL = an existing (e.g. test-premium) account: logged in and kept; otherwise a fresh account is registered and deleted.
  const existing = process.env.TRIP_EMAIL;
  const email = existing ?? `trip+${STAMP}@example.com`;
  const reg = existing
    ? await call('login', 'POST', 'v1/auth/login', { body: { email, password: process.env.TRIP_PASSWORD ?? 'Sm0keTest2026' } })
    : await call('register', 'POST', 'v1/auth/register', { body: { name: 'Trip Repro', email, password: 'Sm0keTest2026', ageConfirmed: true } });
  record(existing ? 'POST v1/auth/login' : 'POST v1/auth/register', reg, `${email} ${reg.json?.tenantId ?? ''}`);
  const token = reg.json?.accessToken;
  if (!token) throw new Error('register failed');
  const A = { token };

  try {
    // Wardrobe: a few pieces from the library (the pack needs a wardrobe).
    const lib = await call('library', 'GET', 'v1/tenant/library/item', A);
    const pick = (c) => (lib.json ?? []).filter((i) => i.category === c).slice(0, 2).map((i) => i.id);
    const libIds = [...pick('top'), ...pick('bottom'), ...pick('shoes'), ...pick('outerwear'), ...pick('dress'), ...pick('accessory')];
    const fromLib = await call('from-library', 'POST', 'v1/tenant/item/from-library', { ...A, body: { items: libIds.map((libraryItemId) => ({ clientMutationId: ulid(), libraryItemId })) } });
    record('POST v1/tenant/item/from-library', fromLib, `${fromLib.json?.createdCount ?? 0} items`);

    // 18: city autocomplete — the form only accepts a picked result; the trip stores its id + name.
    const cities = await call('cities', 'GET', `v1/weather/city?q=${encodeURIComponent(CITY)}`, A);
    const city = Array.isArray(cities.json) ? cities.json[0] : null;
    record('GET v1/weather/city?q=' + CITY, cities, city ? `${cities.json.length} results, first ${city.id} ${city.name} (${city.latitude},${city.longitude})` : cities.json?.code ?? '');

    const startDate = isoDate(addDays(START_IN));
    const endDate = isoDate(addDays(START_IN + DAYS - 1));
    const tripId = ulid();
    // The app's create body (wire/trips.ts fromTripFields + mutations.ts): id, cityId, cityName, dates, types, cabin flag, clientMutationId.
    const createBody = { id: tripId, cityId: city?.id ?? '', cityName: city?.name ?? CITY, startDate, endDate, tripTypes: ['sightseeing', 'dinner'], cabinOnly: false, clientMutationId: ulid() };
    const created = await call('create', 'POST', 'v1/tenant/trip', { ...A, body: createBody });
    record('POST v1/tenant/trip', created, created.json ? `cityId ${created.json.cityId} · ${created.json.cityName} · ${startDate}…${endDate}` : created.json?.code ?? '');

    // A free-text city without an id (an older client / typed city).
    const freeId = ulid();
    const free = await call('create (free text)', 'POST', 'v1/tenant/trip', { ...A, body: { ...createBody, id: freeId, cityId: '', cityName: CITY, clientMutationId: ulid() } });
    record('POST v1/tenant/trip (free-text city, no id)', free, free.json?.code ?? (free.json ? `cityId ${free.json.cityId}` : ''));
    const bogusId = ulid();
    const bogus = await call('create (unresolvable)', 'POST', 'v1/tenant/trip', { ...A, body: { ...createBody, id: bogusId, cityId: '', cityName: 'Qwxzzyq Nowhere', clientMutationId: ulid() } });
    record('POST v1/tenant/trip (unresolvable city)', bogus, bogus.json?.code ?? '');

    // 19: the detail screen — forecast comes from the detail.
    const detail = await call('detail', 'GET', `v1/tenant/trip/${tripId}`, A);
    const weatherDays = (detail.json?.days ?? []).filter((d) => d.weather).length;
    const forecast = detail.json?.forecast;
    record('GET v1/tenant/trip/{id}', detail, `days ${detail.json?.days?.length ?? '-'} (with weather ${weatherDays}) · forecast ${forecast ? `${forecast.status} ${forecast.days?.length ?? 0} days` : 'absent'}`);
    if (free.status === 201) {
      const freeDetail = await call('detail free', 'GET', `v1/tenant/trip/${freeId}`, A);
      record('GET v1/tenant/trip/{id} (free-text city)', freeDetail, `forecast ${freeDetail.json?.forecast ? `${freeDetail.json.forecast.status} ${freeDetail.json.forecast.days?.length ?? 0} days` : 'absent'}`);
    }

    if (city) {
      const w = await call('weather', 'GET', `v1/weather?cityId=${encodeURIComponent(city.id)}`, A);
      const dates = (w.json?.days ?? []).map((d) => d.date);
      record('GET v1/weather?cityId=', w, dates.length ? `${dates.length} days ${dates[0]}…${dates[dates.length - 1]}; trip ${startDate}…${endDate}` : w.json?.code ?? '');
      const w16 = await call('weather 16', 'GET', `v1/weather?cityId=${encodeURIComponent(city.id)}&days=16`, A);
      record('GET v1/weather?cityId=&days=16', w16, w16.json?.days ? `${w16.json.days.length} days` : w16.json?.code ?? '');
    }

    // Pack — build 6 sent requestId `pack_{tripId}` (not a ULID) on the first attempt.
    const pack = await call('pack', 'POST', `v1/tenant/trip/${tripId}/pack`, { ...A, body: { requestId: `pack_${tripId}` } });
    record('POST v1/tenant/trip/{id}/pack (build 6: requestId pack_{tripId})', pack, pack.json?.code ? `${pack.json.code}${pack.json.missing ? ' missing ' + pack.json.missing.join(',') : ''}` : pack.json?.id ? `job ${pack.json.id} ${pack.json.status}` : '');
    // "Try again" sends a fresh ULID; a trip id is a ULID too (the fixed app uses it as the stable first request id).
    const retry = await call('pack retry', 'POST', `v1/tenant/trip/${tripId}/pack`, { ...A, body: { requestId: tripId } });
    record('POST v1/tenant/trip/{id}/pack (fixed app: requestId = trip id)', retry, retry.json?.code ? `${retry.json.code}${retry.json.missing ? ' missing ' + retry.json.missing.join(',') : ''}` : retry.json?.id ? `job ${retry.json.id} ${retry.json.status}` : '');
    if (retry.status === 403 && retry.json?.code === 'premium_required') {
      // Self-premium (dev) — if deployed, become premium and pack again.
      const self = await call('self premium', 'POST', 'v1/tenant/subscription/self-premium', { ...A, body: {} });
      record('POST v1/tenant/subscription/self-premium', self, self.json?.code ?? '');
      if (self.status >= 200 && self.status < 300) {
        const again = await call('pack premium', 'POST', `v1/tenant/trip/${tripId}/pack`, { ...A, body: { requestId: ulid() } });
        record('POST v1/tenant/trip/{id}/pack (premium)', again, again.json?.code ?? (again.json?.id ? `job ${again.json.id} ${again.json.status}` : ''));
        if (again.status === 202) Object.assign(pack, again);
      }
    } else if (retry.status === 202) Object.assign(pack, retry);
    if (pack.status === 202 && pack.json?.id) {
      let job = null;
      for (let i = 0; i < 40; i++) {
        await sleep(3000);
        const j = await call('job', 'GET', `v1/tenant/job/${pack.json.id}`, A);
        job = j;
        if (['completed', 'failed'].includes(j.json?.status)) break;
      }
      const result = job?.json?.result;
      record('GET v1/tenant/job/{id}', job, `${job?.json?.status} ${job?.json?.failure ? JSON.stringify(job.json.failure) : ''}${result ? ` items ${result.items?.length} days ${result.days?.length} missing ${result.missing?.length} refusal ${result.refusal}` : ''}`);
    }

    for (const id of [tripId, freeId, bogusId]) await call('delete trip', 'DELETE', `v1/tenant/trip/${id}`, A);
  } finally {
    if (!existing && !process.env.TRIP_KEEP) {
      const del = await call('delete user', 'DELETE', 'v1/auth/me', A);
      record('DELETE v1/auth/me', del, '');
    }
  }

  console.log('\n\n| Step | Status | Note |\n|---|---|---|');
  for (const r of rows) console.log(`| ${r.step} | ${r.status} | ${String(r.note).replace(/\|/g, '/')} |`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
