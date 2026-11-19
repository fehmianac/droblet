// Local mock of the admin API (docs/api/admin.md) for UI work and screenshots. Not used in production.
//   node scripts/mock-api.mjs            → http://localhost:4010
//   NEXT_PUBLIC_API_BASE_URL=http://localhost:4010 npm run dev
// Sign in with any e-mail + password; the code is 123456 (any other 6 digits = invalid_code).
// MOCK_ROLE=contentEditor|moderator changes the role of the signed-in admin.
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 4010);
const ROLE = process.env.MOCK_ROLE ?? 'superAdmin';
const PERMS = {
  superAdmin: ['dashboard.view', 'analytics.view', 'catalog.manage', 'content.manage', 'image.upload', 'users.read', 'users.suspend', 'users.delete', 'users.grant', 'moderation.manage', 'settings.manage', 'admins.manage', 'audit.view'],
  contentEditor: ['dashboard.view', 'analytics.view', 'catalog.manage', 'content.manage', 'image.upload'],
  moderator: ['dashboard.view', 'users.read', 'users.suspend', 'moderation.manage'],
};
const base = `http://localhost:${PORT}`;
const now = () => new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
const img = (n) => `${base}/img/${n}.svg`;

const me = { id: '01JADMIN0000000000000000', email: 'owner@droblet.test', name: 'Fehmi A.', role: ROLE, permissions: PERMS[ROLE] ?? PERMS.superAdmin };

const brands = [
  ['vakko', 'Vakko', 'direct', null, 1200],
  ['mavi', 'Mavi', 'network', 'admitad', 800],
  ['ipekyol', 'İpekyol', 'network', 'reklamaction', 900],
  ['beymen', 'Beymen', 'direct', null, 1000],
  ['koton', 'Koton', 'network', 'admitad', 700],
  ['network-x', 'Örnek Marka', 'network', 'admitad', null],
].map(([id, name, source, network, bps], i) => ({
  id, name, websiteUrl: `https://${id}.example`, logoUrl: null, source, network, checkoutUrl: `https://${id}.example/cart`,
  clickIdParameter: source === 'direct' ? 'click_id' : 'sub_id', commissionRateBps: bps, retired: i === 5, createdAt: daysAgo(60), updatedAt: daysAgo(i * 3),
}));

const names = [
  ['Keten Gömlek', 'Linen Shirt', 'shirt'], ['İpek Bluz', 'Silk Blouse', 'blouse'], ['Yün Kaban', 'Wool Coat', 'coat'], ['Kot Pantolon', 'Straight Jeans', 'jeans'],
  ['Midi Etek', 'Midi Skirt', 'skirt'], ['Saten Elbise', 'Satin Dress', 'dress'], ['Deri Çanta', 'Leather Bag', 'bag'], ['Loafer', 'Loafers', 'shoes'],
  ['Kaşmir Kazak', 'Cashmere Sweater', 'knitwear'], ['Trençkot', 'Trench Coat', 'coat'], ['Beyaz Tişört', 'White T-shirt', 'tshirt'], ['Blazer Ceket', 'Blazer', 'jacket'],
];
const products = Array.from({ length: 36 }, (_, i) => {
  const [tr, en, category] = names[i % names.length];
  const brand = brands[i % 5];
  const price = 49_990 + ((i * 37_310) % 900_000);
  return {
    id: `${brand.id}-${category}-${i + 1}`, brandId: brand.id, name: { tr, en }, description: { tr: `${tr} — sezonun temel parçası.`, en: `${en} — a season staple.` },
    category, colors: ['white', 'navy', 'camel'].slice(0, 1 + (i % 3)), sizes: ['XS', 'S', 'M', 'L'], priceMinor: price, currency: 'TRY',
    previousPriceMinor: i % 7 === 0 ? price + 20_000 : null, priceChangedAt: i % 7 === 0 ? daysAgo(2) : null, priceBand: i % 4 === 0 ? 'luxuryTouch' : 'highStreet',
    images: [img(i % 6), img((i + 1) % 6)], affiliateUrl: `https://${brand.id}.example/p/${i}`, affiliateSource: brand.source, retired: i % 11 === 10, createdAt: daysAgo(40 - i), updatedAt: daysAgo(i % 9),
  };
});

const looks = (prefix) => Array.from({ length: 7 }, (_, d) => ({
  id: `${prefix}-d${d + 1}`, day: d + 1, title: { tr: `Gün ${d + 1} kombini`, en: `Day ${d + 1} look` }, styleNote: { tr: 'Katmanlı ve sade.', en: 'Layered and calm.' },
  imageUrl: img(d % 6), variants: [{ priceBand: 'highStreet', productIds: [products[d].id, products[d + 1].id] }, { priceBand: 'luxuryTouch', productIds: [products[d + 8].id] }],
}));
const edits = [
  { id: 'edit-2026-11-23', segment: 'women', weekStart: '2026-11-23', title: { tr: 'Kış başı katmanlar', en: 'Early winter layers' }, subtitle: { tr: 'Yedi gün, yedi kombin', en: 'Seven days, seven looks' }, coverImageUrl: img(2), looks: looks('edit-2026-11-23'), sponsorBrandId: null, sponsorName: null, published: true, retired: false, sponsored: false, createdAt: daysAgo(5), updatedAt: daysAgo(1) },
  { id: 'edit-2026-11-30', segment: 'women', weekStart: '2026-11-30', title: { tr: 'Ofis şıklığı', en: 'Office chic' }, subtitle: null, coverImageUrl: null, looks: looks('edit-2026-11-30').slice(0, 4), sponsorBrandId: 'vakko', sponsorName: { tr: 'Vakko ile', en: 'With Vakko' }, published: false, retired: false, sponsored: true, createdAt: daysAgo(2), updatedAt: daysAgo(0) },
];
const collections = {
  creator: [{ id: 'creator-ayse', kind: 'creator', title: { tr: 'Ayşe’nin seçtikleri', en: 'Ayşe picks' }, subtitle: null, imageUrl: img(3), sortOrder: 10, sponsorName: null, retired: false, createdAt: daysAgo(30), updatedAt: daysAgo(3) }],
  series: [{ id: 'series-capsule', kind: 'series', title: { tr: 'Kapsül gardırop', en: 'Capsule wardrobe' }, subtitle: { tr: '10 parça, 30 kombin', en: '10 pieces, 30 looks' }, imageUrl: img(4), sortOrder: 20, sponsorName: null, retired: false, createdAt: daysAgo(20), updatedAt: daysAgo(4) }],
};
const collectionLooks = { 'creator-ayse': [{ id: 'ayse-1', collectionId: 'creator-ayse', title: { tr: 'Hafta sonu', en: 'Weekend' }, note: null, imageUrl: img(1), productIds: [products[0].id], sortOrder: 1, retired: false, createdAt: daysAgo(9), updatedAt: daysAgo(9) }] };
const library = ['white-tshirt', 'black-trousers', 'denim-jacket', 'trench', 'white-sneakers', 'black-bag'].map((id, i) => ({
  id: `lib-${id}`, name: { tr: ['Beyaz tişört', 'Siyah pantolon', 'Kot ceket', 'Trençkot', 'Beyaz spor ayakkabı', 'Siyah çanta'][i], en: ['White T-shirt', 'Black trousers', 'Denim jacket', 'Trench coat', 'White sneakers', 'Black bag'][i] },
  category: ['top', 'bottom', 'outerwear', 'outerwear', 'shoes', 'bag'][i], colorIds: [['white'], ['black'], ['denim'], ['camel'], ['white'], ['black']][i], fabric: ['cotton', 'wool', 'denim', 'cotton', 'leather', 'leather'][i],
  seasons: ['spring', 'summer', 'autumn'].slice(0, 1 + (i % 3)), imageUrl: img(i), sortOrder: i * 10, retired: false, stored: i < 4,
}));
const users = Array.from({ length: 30 }, (_, i) => ({
  id: `01JUSER${String(i).padStart(18, '0')}`, tenantId: `01JTEN${String(i).padStart(19, '0')}`, email: `kullanici${i + 1}@example.com`,
  displayName: ['Ayşe Yılmaz', 'Elif Demir', 'Zeynep Kaya', 'Selin Aksoy', 'Deniz Arslan'][i % 5], handle: `stil${i + 1}`, createdAt: daysAgo(i * 2), suspended: i === 4,
}));
const detail = (u) => ({
  ...u, language: 'tr', closetVisibility: 'followersOnly', providers: ['email', 'apple'], suspendedAt: u.suspended ? daysAgo(1) : null, suspendReason: u.suspended ? 'Spam paylaşımlar' : null,
  counts: { items: 48, looks: 12, trips: 2, followers: 31, following: 18 },
  entitlement: { tier: u.testPremium ? 'premium' : 'free', source: u.testPremium ? 'admin' : null, expiresAt: u.testPremium ?? null, testPremiumExpiresAt: u.testPremium ?? null },
  credits: { allowanceTotal: u.testPremium ? 30 : 0, allowanceRemaining: u.testPremium ? 22 : 0, packBalance: u.credits ?? 0 },
  itemRecognition: { used: 7, limit: 10, unlimited: !!u.testPremium },
  devices: [{ deviceId: 'ios-8F2C', platform: 'ios', updatedAt: daysAgo(0), pushEnabled: true }, { deviceId: 'and-11B7', platform: 'android', updatedAt: daysAgo(12), pushEnabled: false }],
});
const reports = Array.from({ length: 6 }, (_, i) => ({
  id: `01JREP${i}`, status: i < 4 ? 'open' : 'resolved', reporterTenantId: users[i + 1].tenantId, reporterHandle: users[i + 1].handle, targetTenantId: users[i + 5].tenantId, targetHandle: users[i + 5].handle,
  targetKind: ['look', 'profile', 'item'][i % 3], targetId: `look-${i}`, reason: ['spam', 'inappropriate', 'harassment', 'impersonation', 'minorSafety', 'other'][i], note: i % 2 ? 'Tekrarlayan reklam içeriği.' : null,
  createdAt: daysAgo(i), resolution: i >= 4 ? (i === 4 ? 'contentRemoved' : 'dismissed') : null, resolutionNote: null, resolvedByUserId: i >= 4 ? me.id : null, resolvedAt: i >= 4 ? daysAgo(0) : null,
  contentRemovedAt: i === 4 ? daysAgo(0) : null, contentRestoredAt: null, contentRestoredByUserId: null,
}));
const settings = [
  { group: 'entitlements', parameters: ['/droblet/dev/api/Entitlements', '/droblet/dev/worker/Entitlements'], fields: [{ key: 'Premium.TryOnCreditsPerMonth', type: 'int', min: 0, max: 1000, value: 30 }, { key: 'Free.ItemRecognitionLimit', type: 'int', min: 0, max: 1000, value: 10 }, { key: 'SelfServePremium.Enabled', type: 'bool', value: true }] },
  { group: 'packing', parameters: ['/droblet/dev/api/Packing', '/droblet/dev/worker/Packing'], fields: [{ key: 'CabinMaxItems', type: 'int', min: 0, max: 100, value: 12 }, { key: 'MaxTripDays', type: 'int', min: 1, max: 60, value: 21 }] },
  { group: 'ai', parameters: ['/droblet/dev/worker/Ai'], fields: [{ key: 'Enabled', type: 'bool', value: false }] },
  { group: 'notifications', parameters: ['/droblet/dev/api/Notifications'], fields: [{ key: 'DefaultMorningLocal', type: 'time', value: '07:30' }, { key: 'DefaultTimeZone', type: 'timeZone', value: 'Europe/Istanbul' }, { key: 'MaxDevicesPerTenant', type: 'int', min: 1, max: 50, value: 10 }] },
  { group: 'notifierSchedule', parameters: ['/droblet/dev/notifier/Notifications'], fields: [{ key: 'DefaultMorningLocal', type: 'time', value: '07:30' }, { key: 'DefaultWeeklyEditLocal', type: 'weekdayTime', value: 'Mon 09:00' }, { key: 'DefaultFriendRatingsLocal', type: 'time', value: '19:00' }] },
  { group: 'authRateLimits', parameters: ['/droblet/dev/api/AuthRateLimits'], fields: [{ key: 'LoginPerEmailPer15Minutes', type: 'int', min: 1, max: 1000, value: 50 }, { key: 'LoginPerIpPer15Minutes', type: 'int', min: 1, max: 10000, value: 500 }, { key: 'RegisterPerIpPerHour', type: 'int', min: 1, max: 10000, value: 500 }, { key: 'ForgotPerEmailPerHour', type: 'int', min: 1, max: 100, value: 20 }] },
];
const admins = [
  { ...me, disabled: false, passwordSet: true, lastLoginAt: daysAgo(0), createdAt: daysAgo(10), updatedAt: daysAgo(1) },
  { id: '01JADMIN1', email: 'editor@droblet.test', name: 'İçerik Ekibi', role: 'contentEditor', disabled: false, passwordSet: true, lastLoginAt: daysAgo(2), createdAt: daysAgo(8), updatedAt: daysAgo(2) },
  { id: '01JADMIN2', email: 'mod@droblet.test', name: 'Moderasyon', role: 'moderator', disabled: false, passwordSet: false, lastLoginAt: null, createdAt: daysAgo(1), updatedAt: daysAgo(1) },
];
const audit = Array.from({ length: 40 }, (_, i) => ({
  id: `01JAUD${i}`, at: new Date(Date.now() - i * 3_600_000).toISOString(), adminId: admins[i % 2].id, adminEmail: admins[i % 2].email,
  action: ['product.upsert', 'brand.upsert', 'auth.login', 'user.suspend', 'setting.update', 'edit.upsert'][i % 6], targetType: ['product', 'brand', null, 'user', 'setting', 'edit'][i % 6],
  targetId: [products[i % 30].id, 'vakko', null, users[4].id, 'entitlements', 'edit-2026-11-23'][i % 6],
  before: i % 6 === 0 ? JSON.stringify({ priceMinor: 129990 }) : null, after: i % 6 === 0 ? JSON.stringify({ priceMinor: 119990 }) : i % 6 === 4 ? JSON.stringify({ 'Free.ItemRecognitionLimit': 10 }) : null, ip: '203.0.113.7',
}));

function revenue(from, to) {
  const days = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    const seed = (t / 86_400_000) % 13;
    const clicks = 8 + Math.round(10 * Math.abs(Math.sin(seed)));
    const conversions = Math.round(clicks * 0.12 + (seed % 3));
    days.push({ day: d, clicks, conversions, gmvMinor: conversions * 185_000, commissionMinor: conversions * 16_000 });
  }
  const sum = (k) => days.reduce((a, d) => a + d[k], 0);
  const conv = sum('conversions');
  const bucket = (key, share) => ({ key, conversions: Math.round(conv * share), gmvMinor: Math.round(sum('gmvMinor') * share), commissionMinor: Math.round(sum('commissionMinor') * share) });
  return {
    from, to, currency: 'TRY', clicks: sum('clicks'), conversions: conv, gmvMinor: sum('gmvMinor'), commissionMinor: sum('commissionMinor'), pending: Math.round(conv * 0.3), approved: Math.round(conv * 0.6), rejected: 2,
    byBrand: [bucket('vakko', 0.34), bucket('mavi', 0.26), bucket('ipekyol', 0.18), bucket('beymen', 0.14), bucket('koton', 0.08)],
    byLook: [bucket('edit:edit-2026-11-23-d1', 0.3), bucket('none', 0.7)], bySource: [bucket('direct', 0.48), bucket('network', 0.52)],
    byNetwork: [bucket('direct', 0.48), bucket('admitad', 0.34), bucket('reklamaction', 0.18)], byDay: days,
  };
}
const funnel = (from, to) => {
  const names = ['signup_started', 'signup_completed', 'onboarding_style_completed', 'onboarding_body_completed', 'first_item_added', 'first_look_created', 'paywall_viewed', 'subscribed'];
  let actors = 1200;
  const steps = names.map((name, i) => {
    const prev = actors;
    actors = i === 0 ? actors : Math.round(actors * (0.55 + 0.05 * (i % 3)));
    return { name, events: actors * 2, actors, rateFromPrevious: i ? actors / prev : null, rateFromFirst: i ? actors / 1200 : null };
  });
  return { from, to, totalEvents: steps.reduce((a, s) => a + s.events, 0), totalActors: 1200, steps };
};

const garment = (n) => {
  const palette = [['#e9e1d6', '#6e5640'], ['#dfe6ea', '#2f4858'], ['#efe3e3', '#8c3b3b'], ['#e6eadf', '#4d5b3a'], ['#ebe4f0', '#5b4a6e'], ['#f1ebdf', '#a07a3f']][n % 6];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect width="300" height="400" fill="${palette[0]}"/><path d="M110 70l-50 30 20 60 25-12v190h90V148l25 12 20-60-50-30c-8 18-22 28-40 28s-32-10-40-28z" fill="${palette[1]}"/></svg>`;
};

const session = () => ({ accessToken: `mock-access-${Date.now()}`, accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(), refreshToken: `mock-refresh-${Date.now()}`, refreshTokenExpiresAt: new Date(Date.now() + 43_200_000).toISOString(), admin: me });

function page(items, url, size = 25) {
  const start = Number(url.searchParams.get('pageToken') ?? 0);
  const limit = Number(url.searchParams.get('limit') ?? size);
  const slice = items.slice(start, start + limit);
  return { items: slice, pageToken: start + limit < items.length ? String(start + limit) : null, count: items.length };
}

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept-Language');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  const send = (status, data) => {
    res.writeHead(status, data === undefined ? {} : { 'Content-Type': 'application/json' });
    res.end(data === undefined ? undefined : JSON.stringify(data));
  };
  const problem = (status, code, extra = {}) => send(status, { status, title: code, code, ...extra });
  if (req.method === 'OPTIONS') return send(204);
  const url = new URL(req.url, base);
  const p = url.pathname.replace(/\/+$/, '');
  const m = (re) => p.match(re);
  const b = req.method === 'GET' ? {} : await body(req);

  if (p.startsWith('/img/')) {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    return res.end(garment(Number(p.slice(5, -4)) || 0));
  }
  if (p === '/upload') return send(204);

  // Auth
  if (p === '/v1/admin/auth/login') return send(200, { challengeId: 'mock-challenge', expiresAt: new Date(Date.now() + 600_000).toISOString(), codeLength: 6 });
  if (p === '/v1/admin/auth/verify') return b.code === '123456' ? send(200, session()) : problem(401, 'invalid_code', { attemptsLeft: 4 });
  if (p === '/v1/admin/auth/refresh') return String(b.refreshToken ?? '').startsWith('mock-refresh') ? send(200, session()) : problem(401, 'invalid_token');
  if (p === '/v1/admin/auth/password/forgot') return send(202);
  if (p === '/v1/admin/auth/password/reset') return b.token ? send(204) : problem(400, 'invalid_token');
  if (!String(req.headers.authorization ?? '').startsWith('Bearer mock-access')) return send(401);
  if (p === '/v1/admin/auth/me') return send(200, me);
  if (['/v1/admin/auth/logout', '/v1/admin/auth/logout-all'].includes(p) || p === '/v1/admin/auth/password') return send(204);

  if (p === '/v1/admin/dashboard')
    return send(200, { users: { total: 1284, last7Days: 96, suspended: 3 }, catalog: { brands: brands.length, products: products.length, activeProducts: products.filter((x) => !x.retired).length }, content: { edits: edits.length, publishedEdits: 1, collections: 2, libraryItems: library.length }, moderation: { openReports: reports.filter((r) => r.status === 'open').length } });

  // Catalog
  if (p === '/v1/admin/brand') return send(200, brands);
  if ((m(/^\/v1\/admin\/brand\/([^/]+)$/)) && req.method === 'PUT') return send(200, { ...b, id: decodeURIComponent(m(/^\/v1\/admin\/brand\/([^/]+)$/)[1]), createdAt: now(), updatedAt: now() });
  if (m(/^\/v1\/admin\/brand\/([^/]+)$/) && req.method === 'DELETE') return send(204);
  if (p === '/v1/admin/product') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const brand = url.searchParams.get('brand');
    const incl = url.searchParams.get('includeRetired') !== 'false';
    return send(200, page(products.filter((x) => (incl || !x.retired) && (!brand || x.brandId === brand) && (!q || `${x.id} ${x.name.tr} ${x.name.en}`.toLowerCase().includes(q))), url));
  }
  if (p === '/v1/admin/product/bulk') {
    const rows = (b.products ?? []).map((x, index) => (!x.name?.tr ? { index, id: x.id, outcome: 'invalid', errors: { name: ['name_invalid'] } } : !brands.some((br) => br.id === x.brandId) ? { index, id: x.id, outcome: 'brand_not_found' } : { index, id: x.id, outcome: products.some((pr) => pr.id === x.id) ? 'updated' : 'created' }));
    return send(200, { created: rows.filter((r) => r.outcome === 'created').length, updated: rows.filter((r) => r.outcome === 'updated').length, failed: rows.filter((r) => !['created', 'updated'].includes(r.outcome)).length, rows });
  }
  {
    const mm = m(/^\/v1\/admin\/product\/([^/]+)$/);
    if (mm) {
      const id = decodeURIComponent(mm[1]);
      const found = products.find((x) => x.id === id);
      if (req.method === 'GET') return found ? send(200, found) : problem(404, 'product_not_found');
      if (req.method === 'DELETE') return send(204);
      const product = { ...(found ?? {}), ...b, id, currency: 'TRY', affiliateSource: b.affiliateSource ?? 'network', previousPriceMinor: null, priceChangedAt: null, createdAt: found?.createdAt ?? now(), updatedAt: now() };
      return send(200, { product, created: !found, priceDropped: !!found && b.priceMinor < found.priceMinor, watchersFlagged: 2 });
    }
  }
  if (p === '/v1/admin/image/upload-url') return send(200, { url: `${base}/upload`, fields: { key: 'catalog/mock.jpg', 'Content-Type': b.contentType }, key: 'catalog/mock.jpg', publicUrl: img(Math.floor(Math.random() * 6)), expiresAt: new Date(Date.now() + 300_000).toISOString(), maxBytes: 5_242_880 });

  // Content
  if (p === '/v1/admin/edit') return send(200, edits);
  if (m(/^\/v1\/admin\/edit\/([^/]+)$/)) return req.method === 'PUT' ? send(200, { ...b, id: decodeURIComponent(m(/^\/v1\/admin\/edit\/([^/]+)$/)[1]), sponsored: !!b.sponsorBrandId, createdAt: now(), updatedAt: now() }) : send(204);
  {
    const mm = m(/^\/v1\/admin\/collection\/(creator|series)(?:\/([^/]+))?(?:\/look(?:\/([^/]+))?)?$/);
    if (mm) {
      const [, kind, id, lookId] = mm;
      if (!id) return send(200, collections[kind]);
      if (p.includes('/look')) {
        if (!lookId) return send(200, collectionLooks[id] ?? []);
        return req.method === 'PUT' ? send(200, { ...b, id: lookId, collectionId: id, createdAt: now(), updatedAt: now() }) : send(204);
      }
      return req.method === 'PUT' ? send(200, { ...b, id, kind, createdAt: now(), updatedAt: now() }) : send(204);
    }
  }
  if (p === '/v1/admin/library') return send(200, library);
  if (m(/^\/v1\/admin\/library\/([^/]+)$/)) return req.method === 'PUT' ? send(200, { ...b, id: m(/^\/v1\/admin\/library\/([^/]+)$/)[1], stored: true }) : send(204);

  // Users
  if (p === '/v1/admin/user') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase().replace(/^@/, '');
    return send(200, page(users.filter((u) => !q || `${u.email} ${u.handle} ${u.displayName}`.toLowerCase().includes(q)), url));
  }
  {
    const mm = m(/^\/v1\/admin\/user\/([^/]+)(?:\/(.+))?$/);
    if (mm) {
      const u = users.find((x) => x.id === mm[1]);
      if (!u) return problem(404, 'not_found');
      const action = mm[2];
      if (!action && req.method === 'DELETE') return send(204);
      if (action === 'suspend') u.suspended = true;
      if (action === 'unsuspend') u.suspended = false;
      if (action === 'test-premium') u.testPremium = req.method === 'PUT' ? new Date(Date.now() + b.days * 86_400_000).toISOString() : null;
      if (action === 'credits') u.credits = (u.credits ?? 0) + b.credits;
      return send(200, detail(u));
    }
  }
  if (p === '/v1/admin/moderation/report') return send(200, page(reports.filter((r) => r.status === (url.searchParams.get('status') ?? 'open')), url));
  if (m(/^\/v1\/admin\/moderation\/report\/([^/]+)\/resolve$/)) {
    const r = reports.find((x) => x.id === m(/^\/v1\/admin\/moderation\/report\/([^/]+)\/resolve$/)[1]);
    if (r.status === 'open') Object.assign(r, { status: 'resolved', resolution: b.resolution, resolutionNote: b.note, resolvedAt: now(), resolvedByUserId: me.id, contentRemovedAt: b.resolution === 'contentRemoved' ? now() : null });
    return send(200, r);
  }
  if (m(/^\/v1\/admin\/moderation\/report\/([^/]+)\/restore$/)) {
    const r = reports.find((x) => x.id === m(/^\/v1\/admin\/moderation\/report\/([^/]+)\/restore$/)[1]);
    if (!r) return problem(404, 'not_found');
    if (r.status !== 'resolved') return problem(409, 'report_not_resolved');
    if (r.resolution !== 'contentRemoved') return problem(409, 'report_not_content_removed');
    if (!r.contentRestoredAt) Object.assign(r, { contentRestoredAt: now(), contentRestoredByUserId: me.id });
    return send(200, r);
  }

  // Reports
  const today = new Date().toISOString().slice(0, 10);
  const from = url.searchParams.get('from') ?? new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const to = url.searchParams.get('to') ?? today;
  if (p === '/v1/admin/report/revenue') return send(200, revenue(from, to));
  if (p === '/v1/admin/report/funnel') return send(200, funnel(from, to));

  // Settings, admins, audit
  if (p === '/v1/admin/setting') return send(200, settings);
  if (m(/^\/v1\/admin\/setting\/([^/]+)$/)) {
    const g = settings.find((x) => x.group === m(/^\/v1\/admin\/setting\/([^/]+)$/)[1]);
    if (!g) return problem(404, 'not_found');
    for (const f of g.fields) if (f.key in (b.values ?? {})) f.value = b.values[f.key];
    return send(200, g);
  }
  if (p === '/v1/admin/admin-user') return req.method === 'POST' ? send(201, { id: `01JNEW${Date.now()}`, ...b, disabled: false, passwordSet: false, lastLoginAt: null, createdAt: now(), updatedAt: now() }) : send(200, admins);
  if (m(/^\/v1\/admin\/admin-user\/([^/]+)/)) return req.method === 'PUT' ? send(200, { ...admins.find((a) => a.id === m(/^\/v1\/admin\/admin-user\/([^/]+)/)[1]), ...b }) : send(204);
  if (p === '/v1/admin/audit') {
    const action = url.searchParams.get('action') ?? '';
    return send(200, page(audit.filter((a) => a.action.startsWith(action)), url, 50));
  }
  return problem(404, 'not_found');
}).listen(PORT, () => console.log(`Mock admin API on ${base} (role ${ROLE}); sign-in code 123456`));
