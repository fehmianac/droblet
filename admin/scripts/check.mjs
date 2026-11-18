// Runs after `npm run build`: fails the deploy on anything the bucket would serve wrong or the panel would show
// wrong. No dependencies — plain Node. Dictionaries are read from src/i18n/*.ts with the TypeScript compiler.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out');
const src = join(root, 'src');

const failures = [];
let passed = 0;
const expect = (condition, message) => (condition ? (passed += 1) : failures.push(message));

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

// ── 1. Language registry and dictionaries ──────────────────────────────────────────────────────────
// Evaluate each dictionary module (type-only imports are erased by the transpiler).
function loadDictionary(file) {
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, () => ({}));
  const value = Object.values(mod.exports).find((v) => v && typeof v === 'object');
  if (!value) throw new Error(`No dictionary export in ${file}`);
  return value;
}

const registry = readFileSync(join(src, 'i18n', 'index.ts'), 'utf8');
const registered = [...registry.matchAll(/^import \{[^}]*\} from '\.\/(\w+)';$/gm)].map((m) => m[1]);
const languages = (registry.match(/dictionaries = \{([^}]*)\}/)?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
expect(languages.length >= 2, `Registry lists fewer than 2 languages: ${languages.join(', ')}`);
for (const lang of languages) expect(registered.includes(lang), `Language ${lang} has no dictionary file import`);

const dictionaries = Object.fromEntries(languages.map((lang) => [lang, loadDictionary(join(src, 'i18n', `${lang}.ts`))]));
const [base, ...others] = languages;

function keys(value, prefix = '') {
  if (Array.isArray(value)) return [`${prefix}[${value.length}]`];
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
  return [prefix];
}
function leaves(value, prefix = '') {
  if (Array.isArray(value)) return value.map((v, i) => [`${prefix}[${i}]`, v]);
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  return [[prefix, value]];
}

const baseKeys = new Set(keys(dictionaries[base]));
for (const lang of others) {
  const own = new Set(keys(dictionaries[lang]));
  for (const k of baseKeys) expect(own.has(k), `${lang}: missing key ${k}`);
  for (const k of own) expect(baseKeys.has(k), `${lang}: extra key ${k}`);
}
for (const lang of languages) {
  for (const [k, v] of leaves(dictionaries[lang])) {
    expect(typeof v === 'string' && v.trim() !== '', `${lang}: empty value at ${k}`);
    // Placeholders must match between languages ({count}, {email} …).
    if (lang !== base) {
      const ref = leaves(dictionaries[base]).find(([bk]) => bk === k)?.[1];
      if (typeof ref === 'string' && typeof v === 'string') {
        const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
        expect(ph(ref) === ph(v), `${lang}: placeholders differ at ${k} (${ph(ref)} vs ${ph(v)})`);
      }
    }
  }
}

// ── 2. No CSS upper-casing anywhere (source or built CSS) ──────────────────────────────────────────
const uppercaseCss = /text-transform\s*:\s*uppercase/i;
const uppercaseClass = /(className|class)=["'`{][^"'`}]*\buppercase\b/;
for (const file of walk(src).filter((f) => /\.(tsx?|css)$/.test(f))) {
  const text = readFileSync(file, 'utf8');
  expect(!uppercaseCss.test(text), `text-transform: uppercase in ${relative(root, file)}`);
  expect(!uppercaseClass.test(text), `Tailwind "uppercase" class in ${relative(root, file)}`);
}

// ── 3. No secrets in sources ───────────────────────────────────────────────────────────────────────
const secretPatterns = [/AKIA[0-9A-Z]{16}/, /SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /sk-[A-Za-z0-9]{32,}/, /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\./];
for (const file of walk(src).concat(walk(join(root, 'scripts')))) {
  const text = readFileSync(file, 'utf8');
  for (const p of secretPatterns) expect(!p.test(text), `Secret-looking string (${p}) in ${relative(root, file)}`);
}

// ── 4. Static export: every page in every language, plus the root redirects ───────────────────────
if (!existsSync(out)) {
  failures.push('out/ is missing — run `npm run build` first');
} else {
  const pages = walk(join(src, 'app', '[lang]'))
    .filter((f) => f.endsWith('page.tsx'))
    .map((f) =>
      relative(join(src, 'app', '[lang]'), dirname(f))
        .split('/')
        .filter((seg) => seg && !/^\(.*\)$/.test(seg))
        .join('/'),
    );
  for (const lang of languages) {
    for (const page of pages) {
      const file = join(out, lang, page, 'index.html');
      expect(existsSync(file), `Missing exported page: ${relative(root, file)}`);
    }
  }
  for (const file of ['index.html', '404.html', 'reset-password/index.html', 'favicon.svg']) expect(existsSync(join(out, file)), `Missing out/${file}`);

  const builtCss = walk(out).filter((f) => f.endsWith('.css'));
  expect(builtCss.length > 0, 'No CSS in out/');
  for (const file of builtCss) expect(!uppercaseCss.test(readFileSync(file, 'utf8')), `text-transform: uppercase in built ${relative(root, file)}`);

  // The admin panel must never be indexed.
  const html = readFileSync(join(out, languages[0], 'login', 'index.html'), 'utf8');
  expect(/<meta name="robots" content="noindex, ?nofollow"/.test(html), 'login page lacks robots noindex');

  console.log(`Pages: ${pages.length} per language × ${languages.length} languages = ${pages.length * languages.length}`);
}

console.log(`Dictionary keys: ${baseKeys.size} per language (${languages.join(', ')})`);
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`All ${passed} checks passed.`);
