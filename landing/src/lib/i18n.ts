import en from '@content/en.json';
import tr from '@content/tr.json';

/**
 * Language registry. Every string on the site lives in `content/{locale}.json`.
 *
 * Adding a language = one dictionary file + one entry in `registry` below, plus the thin route folder
 * `src/app/{locale}/` (copy `src/app/en/`). The Turkish file is the shape every other file must match;
 * `npm run typecheck` and `npm run check` both fail on a missing key.
 */
export type Dictionary = typeof tr;

type LocaleEntry = {
  /** BCP 47 tag for `<html lang>` and hreflang. */
  htmlLang: string;
  /** Open Graph locale. */
  ogLocale: string;
  /** Short label in the footer language switch — typed as displayed, never transformed by CSS. */
  label: string;
  /** Name of the language in that language (accessible name of the switch link). */
  name: string;
  dictionary: Dictionary;
};

const registry = {
  tr: { htmlLang: 'tr', ogLocale: 'tr_TR', label: 'TR', name: 'Türkçe', dictionary: tr },
  en: { htmlLang: 'en', ogLocale: 'en_GB', label: 'EN', name: 'English', dictionary: en },
} satisfies Record<string, LocaleEntry>;

export type Locale = keyof typeof registry;

export const defaultLocale: Locale = 'tr';
export const locales = Object.keys(registry) as Locale[];

export function localeInfo(locale: Locale): LocaleEntry {
  return registry[locale];
}

export function getDictionary(locale: Locale): Dictionary {
  return registry[locale].dictionary;
}

/** One section of the dictionary in every language — what a client component needs to switch language itself. */
export function inEveryLocale<T>(pick: (dictionary: Dictionary) => T): Record<Locale, T> {
  return Object.fromEntries(locales.map((locale) => [locale, pick(getDictionary(locale))])) as Record<Locale, T>;
}

/**
 * Site path of a page in a language. `page` is the path in the default language ("/", "/terms/").
 * The default language lives at the root, the others under `/{locale}`.
 */
export function localePath(locale: Locale, page: string): string {
  const path = page.startsWith('/') ? page : `/${page}`;
  return locale === defaultLocale ? path : `/${locale}${path}`;
}

/** First registered language the browser asks for, or null. */
export function matchLocale(languages: readonly string[]): Locale | null {
  for (const language of languages) {
    const base = language.toLowerCase().split('-')[0];
    const match = locales.find((locale) => locale === base);
    if (match) return match;
  }
  return null;
}

/** Fills `{name}` style placeholders. */
export function format(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}
