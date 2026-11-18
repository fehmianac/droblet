/**
 * THE language registry. Adding a language = its locale files + one entry here:
 *
 *   src/i18n/de.json                 base strings (same keys as tr.json)
 *   src/i18n/features/de/            copy of features/tr/ (same file names, translated; index.ts unchanged)
 *
 *   import de from './de.json';
 *   import deFeatures from './features/de';
 *   de: defineLanguage('de-DE', 'Deutsch', { base: de, ...deFeatures }),
 *
 * `languages.test.ts` fails when a registered language misses a locale file or a key that Turkish
 * has, has one Turkish does not, ships an empty string or uses different interpolation variables.
 * Everything else — device-language detection, the language switch (29) and its persistence
 * (`./preference.ts`), Intl formatting, the `Accept-Language` header, upper-casing — reads this registry.
 *
 * Native permission dialogs are a separate OS mechanism: also add `locales/ios/<code>.json` and list
 * it under `locales` in app.config.ts.
 */
import en from './en.json';
import enFeatures from './features/en';
import trFeatures from './features/tr';
import tr from './tr.json';

type LocaleFile = Record<string, unknown>;
type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void ? I : never;

export type LanguageDefinition<F extends Record<string, LocaleFile> = Record<string, LocaleFile>> = {
  /** BCP-47 tag for Intl (dates, numbers, currency) and the `Accept-Language` header. */
  localeTag: string;
  /** The language's own name, shown in the language switch (29). */
  name: string;
  /** The locale files by name (`base` + one per feature). Top-level keys are unique across files. */
  files: F;
  /** All translations of the language, merged into the default namespace. */
  resources: UnionToIntersection<F[keyof F]>;
};

function defineLanguage<F extends Record<string, LocaleFile>>(localeTag: string, name: string, files: F): LanguageDefinition<F> {
  return { localeTag, name, files, resources: Object.assign({}, ...Object.values(files)) as UnionToIntersection<F[keyof F]> };
}

export const LANGUAGES = {
  tr: defineLanguage('tr-TR', 'Türkçe', { base: tr, ...trFeatures }),
  en: defineLanguage('en-GB', 'English', { base: en, ...enFeatures }),
};

export type AppLanguage = keyof typeof LANGUAGES;

/** Shown when the device language is not registered, and the fallback for any missing key. */
export const DEFAULT_LANGUAGE: AppLanguage = 'tr';

export const SUPPORTED_LANGUAGES = Object.keys(LANGUAGES) as AppLanguage[];

export function isSupportedLanguage(code: string | null | undefined): code is AppLanguage {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(LANGUAGES, code);
}
