// Runs after `npm run build`: reads content/ and out/ and fails the deploy on anything a bucket would
// serve wrong. No dependencies — plain Node.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { legalDocsDir, legalMarkdownFiles } from './legal-markdown.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out');
const contentDir = join(root, 'content');
const defaultLocale = 'tr';

const failures = [];
let passed = 0;
const fail = (message) => failures.push(message);
const ok = () => {
  passed += 1;
};
const expect = (condition, message) => (condition ? ok() : fail(message));

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

// ── 1. Dictionaries: every language has exactly the keys (and list lengths) of the default one ──────
const dictionaries = Object.fromEntries(
  readdirSync(contentDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => [name.replace(/\.json$/, ''), JSON.parse(readFileSync(join(contentDir, name), 'utf8'))]),
);
const locales = Object.keys(dictionaries);
expect(locales.includes(defaultLocale), `content/${defaultLocale}.json is missing`);

function shape(value, path, into) {
  if (Array.isArray(value)) {
    into.set(path, `list(${value.length})`);
    value.forEach((item, index) => shape(item, `${path}[${index}]`, into));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) shape(child, path ? `${path}.${key}` : key, into);
  } else {
    into.set(path, typeof value);
    if (typeof value === 'string' && value.trim() === '') fail(`empty string at ${path}`);
  }
  return into;
}

const reference = shape(dictionaries[defaultLocale] ?? {}, '', new Map());
for (const locale of locales) {
  if (locale === defaultLocale) continue;
  const other = shape(dictionaries[locale], '', new Map());
  for (const [key, kind] of reference) {
    if (!other.has(key)) fail(`content/${locale}.json: missing key "${key}"`);
    else if (other.get(key) !== kind) fail(`content/${locale}.json: "${key}" is ${other.get(key)}, expected ${kind}`);
    else ok();
  }
  for (const key of other.keys()) {
    if (!reference.has(key)) fail(`content/${locale}.json: extra key "${key}" (not in ${defaultLocale}.json)`);
  }
  // Placeholders such as {name} must survive translation.
  const placeholders = (text) => (typeof text === 'string' ? (text.match(/\{\w+\}/g) ?? []).sort().join() : '');
  const flat = (value, path, into) => {
    if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) flat(child, `${path}.${key}`, into);
    } else into.set(path, value);
    return into;
  };
  const a = flat(dictionaries[defaultLocale], '', new Map());
  const b = flat(dictionaries[locale], '', new Map());
  for (const [key, text] of a) {
    if (placeholders(text) !== placeholders(b.get(key))) fail(`content/${locale}.json: placeholders differ at "${key.slice(1)}"`);
  }
}

// ── 2. Exported pages ──────────────────────────────────────────────────────────────────────────────
if (!existsSync(out)) {
  console.error('check: out/ not found — run `npm run build` first.');
  process.exit(1);
}

const pages = [
  '',
  'terms',
  'privacy',
  'kvkk',
  'consents',
  'subscription-terms',
  'cookies',
  'community-guidelines',
  'delete-account',
  'reset-password',
  'verify-email',
  'invite',
  'l',
  'parent-consent',
];
const legalPages = ['terms', 'privacy', 'kvkk', 'consents', 'subscription-terms', 'cookies', 'community-guidelines'];

const htmlLang = (html) => /<html[^>]*\slang="([^"]+)"/.exec(html)?.[1];

for (const locale of locales) {
  for (const page of pages) {
    const file = join(out, locale === defaultLocale ? '' : locale, page, 'index.html');
    const label = relative(root, file);
    if (!existsSync(file)) {
      fail(`${label} is missing`);
      continue;
    }
    const html = readFileSync(file, 'utf8');
    expect(htmlLang(html) === locale, `${label}: <html lang> is "${htmlLang(html)}", expected "${locale}"`);
    for (const other of locales) {
      expect(new RegExp(`<link[^>]+hrefLang="${other}"`, 'i').test(html), `${label}: no hreflang alternate for "${other}"`);
    }
    expect(/<title>[^<]+<\/title>/.test(html), `${label}: no <title>`);
    expect(/<meta name="description" content="[^"]+"/.test(html), `${label}: no meta description`);
    if (legalPages.includes(page)) {
      const banner = dictionaries[locale].legal.draftTitle;
      expect(html.includes(banner), `${label}: draft banner "${banner}" not found`);
      expect(/<meta name="robots" content="noindex/.test(html), `${label}: legal draft must be noindex`);
      expect(html.includes(dictionaries[locale].legal.summaryLabel), `${label}: summary box not found`);
      // Every legal page is reachable from the footer of every page in that language.
      const href = `${locale === defaultLocale ? '' : `/${locale}`}/${page}/`;
      expect(html.includes(`href="${href}"`), `${label}: footer does not link to ${href}`);
    }
  }
}

for (const file of ['404.html', 'robots.txt', 'sitemap.xml', 'og.png']) {
  expect(existsSync(join(out, file)), `out/${file} is missing`);
}

// ── 2b. Teen parental-consent page behind the draft flag (docs/api/teen.md §9) ───────────────────
// Its wording is a legal draft: without NEXT_PUBLIC_TEEN_PARENT_CONSENT=1 none of `parentConsent.draft` may reach out/
// (HTML, RSC payload or scripts). Run the check with the same value of the flag as the build.
const teenFlagOn = (process.env.NEXT_PUBLIC_TEEN_PARENT_CONSENT ?? '').trim() === '1';
const outText = walk(out)
  .filter((path) => /\.(html|txt|js|json)$/.test(path))
  .map((path) => [relative(root, path), readFileSync(path, 'utf8')]);
// Long runs without characters that HTML / JSON escaping changes, so a match is found in any encoding.
const fragments = (value) =>
  (typeof value === 'string' ? [value] : Object.values(value ?? {}).flatMap(fragments))
    .flatMap((text) => (typeof text === 'string' ? text.split(/[{}"'&<>\\]/) : []))
    .map((part) => part.trim())
    .filter((part) => part.length >= 24);
for (const locale of locales) {
  const t = dictionaries[locale].parentConsent;
  const file = join(out, locale === defaultLocale ? '' : locale, 'parent-consent', 'index.html');
  if (!t || !existsSync(file)) continue;
  const label = relative(root, file);
  const html = readFileSync(file, 'utf8');
  expect(/<meta name="robots" content="noindex/.test(html), `${label}: must be noindex`);
  const bannerShown = html.includes(t.draft.draftTitle);
  if (teenFlagOn) {
    expect(bannerShown, `${label}: flag is on but the draft banner "${t.draft.draftTitle}" is missing`);
  } else {
    expect(!bannerShown, `${label}: shows the draft banner although NEXT_PUBLIC_TEEN_PARENT_CONSENT is not "1" (build and check must see the same flag)`);
    expect(html.includes(t.unavailableTitle), `${label}: flag is off but "${t.unavailableTitle}" is missing`);
    const { draftNote, ...draft } = t.draft;
    void draftNote;
    // Generic sentences shared with other pages (network errors…) are not draft wording.
    const elsewhere = JSON.stringify({ ...dictionaries[locale], parentConsent: { ...t, draft: null } });
    for (const fragment of new Set(fragments(draft).filter((part) => !elsewhere.includes(part)))) {
      const leak = outText.find(([, text]) => text.includes(fragment));
      expect(!leak, `draft text "${fragment.slice(0, 40)}…" is in ${leak?.[0]} although the draft flag is off`);
    }
  }
}
const sitemapFile = join(out, 'sitemap.xml');
if (existsSync(sitemapFile)) expect(!readFileSync(sitemapFile, 'utf8').includes('parent-consent'), 'sitemap.xml must not list /parent-consent/');
for (const [label, text] of outText.filter(([path]) => path.endsWith('.html') && !path.includes('parent-consent'))) {
  expect(!/href="[^"]*parent-consent/.test(text), `${label}: links to /parent-consent/ (the page must not be linked from anywhere)`);
}

// ── 3. .well-known ─────────────────────────────────────────────────────────────────────────────────
function readJson(path) {
  const file = join(out, path);
  if (!existsSync(file)) {
    fail(`out/${path} is missing`);
    return null;
  }
  try {
    ok();
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`out/${path} is not valid JSON: ${error.message}`);
    return null;
  }
}

const aasa = readJson('.well-known/apple-app-site-association');
if (aasa) {
  const details = aasa.applinks?.details ?? [];
  const ids = details.flatMap((detail) => [detail.appID, ...(detail.appIDs ?? [])]).filter(Boolean);
  expect(ids.length > 0 && ids.every((id) => /^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/.test(id)), 'apple-app-site-association: appID must be TEAMID.bundle');
  const paths = details.flatMap((detail) => detail.paths ?? []);
  for (const path of ['/reset-password*', '/verify-email*', '/invite/*', '/l/*']) {
    expect(paths.includes(path), `apple-app-site-association: path "${path}" is missing`);
  }
}

const assetlinks = readJson('.well-known/assetlinks.json');
if (assetlinks) {
  expect(Array.isArray(assetlinks) && assetlinks.length > 0, 'assetlinks.json: must be a non-empty array');
  const target = assetlinks[0]?.target ?? {};
  expect(typeof target.package_name === 'string' && target.package_name.length > 0, 'assetlinks.json: package_name is missing');
  const fingerprints = target.sha256_cert_fingerprints ?? [];
  expect(fingerprints.length > 0, 'assetlinks.json: sha256_cert_fingerprints is empty');
  if (fingerprints.includes('REPLACE_WITH_UPLOAD_KEY_SHA256')) {
    console.warn('check: WARNING assetlinks.json still has the REPLACE_WITH_UPLOAD_KEY_SHA256 placeholder — Android app links will not verify (see README).');
  }
}

// ── 4. Project rules on the output ─────────────────────────────────────────────────────────────────
const files = walk(out);
const upper = /text-transform\s*:\s*uppercase/i;

for (const file of files.filter((path) => path.endsWith('.css'))) {
  expect(!upper.test(readFileSync(file, 'utf8')), `${relative(root, file)}: contains "text-transform: uppercase" — type the label upper-case in content/ instead`);
}

for (const file of files.filter((path) => path.endsWith('.html'))) {
  const html = readFileSync(file, 'utf8');
  const label = relative(root, file);
  expect(!upper.test(html), `${label}: contains "text-transform: uppercase"`);
  expect(!/\bclass="[^"]*\buppercase\b/.test(html), `${label}: uses the "uppercase" class`);
  expect(!/fonts\.(googleapis|gstatic)\.com/.test(html), `${label}: requests Google Fonts at runtime`);

  // Every internal link is a file the bucket can serve.
  for (const [, href] of html.matchAll(/<a\b[^>]*\shref="(\/[^"#?]*)[^"]*"/g)) {
    const target = href.endsWith('/') ? join(out, href, 'index.html') : join(out, href);
    expect(existsSync(target), `${label}: link to "${href}" has no file in out/`);
  }
}

// ── 5. Legal Markdown for review (docs/legal/) matches the dictionaries ────────────────────────────
// Only inside the full repository: a deploy that checks out landing/ alone has no docs/ folder.
if (existsSync(legalDocsDir)) {
  for (const [path, content] of legalMarkdownFiles()) {
    const label = relative(join(root, '..'), path);
    expect(existsSync(path) && readFileSync(path, 'utf8') === content, `${label} is out of date — run \`npm run legal:md\``);
  }
}

// ── 6. App screenshots ─────────────────────────────────────────────────────────────────────────────
// Every language has the same set of screenshots; each page shows its own language's set, and every
// screenshot a page references is in out/. Weight budgets keep the landing page light.
const screensDir = join(out, 'screens');
const screenSets = Object.fromEntries(
  locales.map((locale) => {
    const dir = join(screensDir, locale);
    return [locale, existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.webp')).sort() : []];
  }),
);
for (const locale of locales) {
  expect(screenSets[locale].length > 0, `out/screens/${locale}/ has no screenshots`);
  expect(
    screenSets[locale].join() === screenSets[defaultLocale].join(),
    `out/screens/${locale}/ differs from out/screens/${defaultLocale}/ (${screenSets[locale].join(', ')})`,
  );
  const bytes = screenSets[locale].reduce((sum, name) => sum + statSync(join(screensDir, locale, name)).size, 0);
  expect(bytes < 2.5 * 1024 * 1024, `out/screens/${locale}/ weighs ${(bytes / 1048576).toFixed(2)} MB (budget 2.5 MB)`);

  const home = join(out, locale === defaultLocale ? '' : locale, 'index.html');
  if (!existsSync(home)) continue;
  const html = readFileSync(home, 'utf8');
  const referenced = [...html.matchAll(/<img\b[^>]*\ssrc="(\/screens\/[^"]+)"/g)].map(([, src]) => src);
  expect(referenced.length > 0, `${relative(root, home)}: shows no app screenshot`);
  for (const src of new Set(referenced)) {
    expect(src.startsWith(`/screens/${locale}/`), `${relative(root, home)}: shows "${src}" from another language`);
    for (const other of locales) {
      const file = join(out, src.replace(`/screens/${locale}/`, `/screens/${other}/`));
      expect(existsSync(file), `${relative(root, home)}: screenshot "${relative(out, file)}" is missing`);
    }
  }
  for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
    expect(/\salt="[^"]+"/.test(tag), `${relative(root, home)}: <img> without alt text: ${tag.slice(0, 80)}`);
    expect(/\swidth="\d+"/.test(tag) && /\sheight="\d+"/.test(tag), `${relative(root, home)}: <img> without width/height`);
  }
  const hero = join(screensDir, locale, 'today.webp');
  if (existsSync(hero)) expect(statSync(hero).size < 400 * 1024, `out/screens/${locale}/today.webp (hero) is over 400 KB`);
}

// ── Result ─────────────────────────────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`check: ${failures.length} problem(s)`);
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}
console.log(`check: ok — ${passed} assertions, languages: ${locales.join(', ')}`);
