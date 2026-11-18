import { DEFAULT_LANGUAGE, LANGUAGES, SUPPORTED_LANGUAGES } from './languages';

type Json = { [key: string]: Json | string };

/** CLDR plural categories differ per language (`_one/_other` in TR/EN, `_few/_many` elsewhere): compare the base key. */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function keys(obj: Json, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`)));
}

function baseKeys(language: keyof typeof LANGUAGES): string[] {
  return [...new Set(keys(LANGUAGES[language].resources as Json).map((k) => k.replace(PLURAL_SUFFIX, '')))].sort();
}

function leaves(obj: Json, prefix = ''): [string, string][] {
  return Object.entries(obj).flatMap(([k, v]) => (typeof v === 'string' ? [[`${prefix}${k}`, v] as [string, string]] : leaves(v, `${prefix}${k}.`)));
}

describe('language registry', () => {
  const reference = baseKeys(DEFAULT_LANGUAGE);
  const others = SUPPORTED_LANGUAGES.filter((code) => code !== DEFAULT_LANGUAGE);

  it('registers Turkish (default) and English', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(expect.arrayContaining(['tr', 'en']));
    expect(DEFAULT_LANGUAGE).toBe('tr');
  });

  it.each(others)('%s has every key Turkish has (nothing missing)', (code) => {
    const own = new Set(baseKeys(code));
    expect(reference.filter((k) => !own.has(k))).toEqual([]);
  });

  it.each(others)('%s has no key that Turkish lacks (nothing orphaned)', (code) => {
    const ref = new Set(reference);
    expect(baseKeys(code).filter((k) => !ref.has(k))).toEqual([]);
  });

  it.each(SUPPORTED_LANGUAGES)('%s: no empty strings, and every locale tag is a valid BCP-47 tag', (code) => {
    expect(leaves(LANGUAGES[code].resources as Json).filter(([, v]) => v.trim() === '').map(([k]) => k)).toEqual([]);
    expect(Intl.getCanonicalLocales(LANGUAGES[code].localeTag)).toHaveLength(1);
  });

  it.each(others)('%s uses the same interpolation variables as Turkish', (code) => {
    const vars = (s: string) => [...s.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((m) => m[1]).sort().join(',');
    const tr = new Map(leaves(LANGUAGES[DEFAULT_LANGUAGE].resources as Json));
    const mismatched = leaves(LANGUAGES[code].resources as Json)
      // A singular form may legitimately drop {{count}} ("one image"); compare only keys present in both.
      .filter(([k, v]) => tr.has(k) && !PLURAL_SUFFIX.test(k) && vars(tr.get(k) ?? '') !== vars(v))
      .map(([k]) => k);
    expect(mismatched).toEqual([]);
  });
});
