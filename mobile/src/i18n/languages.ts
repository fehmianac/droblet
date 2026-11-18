/**
 * THE language registry. Adding a language = one locale file + one entry here:
 *
 *   import de from './de.json';                       // every key of tr.json + the feature files, in one file
 *   de: { localeTag: 'de-DE', resources: de },
 *
 * (A language may also be split per feature like TR/EN are — spread the parts into `resources`.)
 * `languages.test.ts` fails when a registered language misses a key that Turkish has, or has one
 * Turkish does not. Everything else — device-language detection, Intl formatting, the
 * `Accept-Language` header, upper-casing — reads this registry.
 *
 * Native permission dialogs are a separate OS mechanism: also add `locales/ios/<code>.json` and list
 * it under `locales` in app.config.ts.
 */
import en from './en.json';
import { featuresEn, featuresTr } from './features';
import tr from './tr.json';

export type LanguageDefinition = {
  /** BCP-47 tag for Intl (dates, numbers, currency) and the `Accept-Language` header. */
  localeTag: string;
  /** All translations of the language, in the default namespace. */
  resources: Record<string, unknown>;
};

export const LANGUAGES = {
  tr: { localeTag: 'tr-TR', resources: { ...tr, ...featuresTr } },
  en: { localeTag: 'en-GB', resources: { ...en, ...featuresEn } },
} satisfies Record<string, LanguageDefinition>;

export type AppLanguage = keyof typeof LANGUAGES;

/** Shown when the device language is not registered, and the fallback for any missing key. */
export const DEFAULT_LANGUAGE: AppLanguage = 'tr';

export const SUPPORTED_LANGUAGES = Object.keys(LANGUAGES) as AppLanguage[];

export function isSupportedLanguage(code: string | null | undefined): code is AppLanguage {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(LANGUAGES, code);
}
