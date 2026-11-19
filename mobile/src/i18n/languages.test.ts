import { DEFAULT_LANGUAGE, isSupportedLanguage, LANGUAGES, SUPPORTED_LANGUAGES, type AppLanguage } from './languages';

/**
 * THE parity test: every locale file (base + per-feature) of every registered language is compared
 * with Turkish, file by file. A new language is covered as soon as it is in the registry.
 */
type Json = { [key: string]: Json | string };

/** CLDR plural categories differ per language (`_one/_other` in TR/EN, `_few/_many` elsewhere): compare the base key. */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function leaves(obj: Json, prefix = ''): [string, string][] {
  return Object.entries(obj).flatMap(([k, v]) => (typeof v === 'string' ? [[`${prefix}${k}`, v] as [string, string]] : leaves(v, `${prefix}${k}.`)));
}

function filesOf(language: AppLanguage): Record<string, Json> {
  return LANGUAGES[language].files as unknown as Record<string, Json>;
}

function baseKeys(file: Json): string[] {
  return [...new Set(leaves(file).map(([k]) => k.replace(PLURAL_SUFFIX, '')))].sort();
}

/** `file:key` for every string of the language. */
function allLeaves(language: AppLanguage): [string, string][] {
  return Object.entries(filesOf(language)).flatMap(([file, json]) => leaves(json).map(([k, v]) => [`${file}:${k}`, v] as [string, string]));
}

describe('language registry', () => {
  const reference = filesOf(DEFAULT_LANGUAGE);
  const fileNames = Object.keys(reference).sort();
  const others = SUPPORTED_LANGUAGES.filter((code) => code !== DEFAULT_LANGUAGE);

  it('registers Turkish (default) and English, each with a name and a valid BCP-47 tag', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(expect.arrayContaining(['tr', 'en']));
    expect(DEFAULT_LANGUAGE).toBe('tr');
    SUPPORTED_LANGUAGES.forEach((code) => {
      expect(LANGUAGES[code].name.trim().length).toBeGreaterThan(0);
      expect(Intl.getCanonicalLocales(LANGUAGES[code].localeTag)).toHaveLength(1);
    });
    expect(isSupportedLanguage('tr')).toBe(true);
    expect(isSupportedLanguage('xx')).toBe(false);
    expect(isSupportedLanguage('toString')).toBe(false);
    expect(isSupportedLanguage(null)).toBe(false);
  });

  it('covers the base file and every feature file', () => {
    expect(fileNames).toEqual(['account', 'ai', 'base', 'commerce', 'consent', 'detect', 'friends', 'looks', 'outfitImport', 'purchase', 'requirements', 'social', 'stylist', 'today', 'wardrobe']);
  });

  it.each(others)('%s has the same locale files as Turkish', (code) => {
    expect(Object.keys(filesOf(code)).sort()).toEqual(fileNames);
  });

  it.each(others)('%s has every key Turkish has, in the same file (nothing missing)', (code) => {
    const missing = fileNames.flatMap((file) => {
      const own = new Set(baseKeys(filesOf(code)[file] ?? {}));
      return baseKeys(reference[file]).filter((k) => !own.has(k)).map((k) => `${file}:${k}`);
    });
    expect(missing).toEqual([]);
  });

  it.each(others)('%s has no key that Turkish lacks (nothing orphaned)', (code) => {
    const extra = Object.entries(filesOf(code)).flatMap(([file, json]) => {
      const ref = new Set(baseKeys(reference[file] ?? {}));
      return baseKeys(json).filter((k) => !ref.has(k)).map((k) => `${file}:${k}`);
    });
    expect(extra).toEqual([]);
  });

  it.each(SUPPORTED_LANGUAGES)('%s: no empty strings', (code) => {
    expect(allLeaves(code).filter(([, v]) => v.trim() === '').map(([k]) => k)).toEqual([]);
  });

  it.each(others)('%s uses the same interpolation variables as Turkish', (code) => {
    const vars = (s: string) => [...s.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((m) => m[1]).sort().join(',');
    const tr = new Map(allLeaves(DEFAULT_LANGUAGE));
    const mismatched = allLeaves(code)
      // A singular form may legitimately drop {{count}} ("one image"); compare only keys present in both.
      .filter(([k, v]) => tr.has(k) && !PLURAL_SUFFIX.test(k) && vars(tr.get(k) ?? '') !== vars(v))
      .map(([k]) => k);
    expect(mismatched).toEqual([]);
  });

  it.each(SUPPORTED_LANGUAGES)('%s: no top-level key is defined in two files', (code) => {
    const owner = new Map<string, string>();
    const duplicates: string[] = [];
    for (const [file, json] of Object.entries(filesOf(code))) {
      for (const key of Object.keys(json)) {
        const first = owner.get(key);
        if (first) duplicates.push(`${key}: ${first} + ${file}`);
        else owner.set(key, file);
      }
    }
    expect(duplicates).toEqual([]);
    // Nothing is lost in the merge into the default namespace.
    expect(Object.keys(LANGUAGES[code].resources).sort()).toEqual([...owner.keys()].sort());
  });

  it.each(SUPPORTED_LANGUAGES)('%s: ships no bracketed, price or brand placeholders', (code) => {
    const bad = allLeaves(code)
      .filter(([, v]) => /\[[A-ZİĞÜŞÖÇ ]+\]|\[(FİYAT|AYLIK FİYAT|YILLIK FİYAT|PLAN ADI|MARKA|Marka)\]/.test(v))
      .map(([k]) => k);
    expect(bad).toEqual([]);
    // Feature files never hard-code a currency sign or a percent pattern: amounts go through `formatMoney` / `formatPercent`.
    const hardCoded = Object.entries(filesOf(code))
      .filter(([file]) => ['commerce', 'social', 'account'].includes(file))
      .flatMap(([file, json]) => leaves(json).filter(([, v]) => /₺|%\{\{/.test(v)).map(([k]) => `${file}:${k}`));
    expect(hardCoded).toEqual([]);
  });
});

describe('upper-case labels are typed upper-case in the locale file (never transformed in code)', () => {
  const tr = LANGUAGES.tr.files;
  const strip = (label: string) => label.replace(/\{\{[^}]+\}\}/g, '');

  it('TR eyebrows / tags of every feature file use Turkish casing (dotted İ)', () => {
    const offenders = Object.entries(filesOf('tr'))
      .filter(([file]) => file !== 'base')
      .flatMap(([file, json]) =>
        leaves(json)
          .filter(([k, v]) => /(eyebrow|Tag)$/.test(k) && strip(v) !== strip(v).toLocaleUpperCase('tr-TR'))
          .map(([k]) => `${file}:${k}`),
      );
    expect(offenders).toEqual([]);
  });

  it('named TR labels are upper-case with the dotted İ (no ASCII "I" where "İ" is meant)', () => {
    [
      tr.base.style.eyebrow,
      tr.base.body.eyebrow,
      tr.base.firstItems.eyebrow,
      tr.base.today.lookEyebrow,
      tr.base.aiBadge.onYou,
      tr.commerce.explore.editEyebrow,
      tr.commerce.explore.sponsored,
      tr.commerce.shop.brandEyebrow,
      tr.commerce.shop.sortEyebrow,
      tr.commerce.watchlist.eyebrow,
      tr.account.me.creditsEyebrow,
      tr.account.settings.visibilityEyebrow,
      tr.account.settings.photosEyebrow,
      tr.account.settings.languageEyebrow,
      tr.account.deleteAccount.eyebrow,
      tr.account.deleteAccount.confirmWord,
      tr.account.palette.seasonEyebrow,
      tr.account.palette.avoidEyebrow,
      tr.account.credits.eyebrow,
    ].forEach((label) => expect(strip(label)).toBe(strip(label).toLocaleUpperCase('tr-TR')));
    expect(tr.base.style.eyebrow).toBe('STİL PROFİLİ');
    expect(tr.account.settings.notificationsEyebrow).toBe('BİLDİRİMLER');
  });

  it('EN labels are upper-case too', () => {
    const label = LANGUAGES.en.files.account.settings.photosEyebrow;
    expect(label).toBe(label.toUpperCase());
  });
});
