import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { DEFAULT_LANGUAGE, isSupportedLanguage, LANGUAGES, SUPPORTED_LANGUAGES, type AppLanguage } from './languages';

export { DEFAULT_LANGUAGE, isSupportedLanguage, LANGUAGES, SUPPORTED_LANGUAGES, type AppLanguage };

/**
 * i18next resources, built from the language registry (`./languages.ts`). Per-language feature files
 * (src/i18n/features/<code>/) are merged into the default namespace under their own top-level keys.
 */
export const resources: Record<string, { translation: Record<string, unknown> }> = {};
for (const code of SUPPORTED_LANGUAGES) {
  resources[code] = { translation: LANGUAGES[code].resources };
}

/**
 * The first device language that is registered; Turkish otherwise.
 * The manual switch (29) and its persistence live in `./preference.ts`; everything below follows it.
 */
export function detectLanguage(): AppLanguage {
  for (const locale of getLocales()) {
    if (isSupportedLanguage(locale.languageCode)) return locale.languageCode;
  }
  return DEFAULT_LANGUAGE;
}

// eslint-disable-next-line import/no-named-as-default-member -- i18next's documented plugin API
void i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** The registered language for an i18next language code (`en-GB` → `en`); Turkish when not registered. */
export function toAppLanguage(code: string | null | undefined): AppLanguage {
  const base = code?.split('-')[0];
  return isSupportedLanguage(code) ? code : isSupportedLanguage(base) ? base : DEFAULT_LANGUAGE;
}

/**
 * The app language right now — for code outside React (request headers, fixtures, effects).
 * Components use `useAppLanguage()` instead: the React Compiler memoizes a plain call like this one
 * for the component's lifetime, so a component reading it would keep the language it first saw.
 */
export function currentLanguage(): AppLanguage {
  return toAppLanguage(i18n.language);
}

/** BCP-47 tag used for Intl formatting and the `Accept-Language` request header. */
export function currentLocaleTag(): string {
  return LANGUAGES[currentLanguage()].localeTag;
}

export default i18n;
