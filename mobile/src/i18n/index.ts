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

export function currentLanguage(): AppLanguage {
  const base = i18n.language?.split('-')[0];
  return isSupportedLanguage(i18n.language) ? i18n.language : isSupportedLanguage(base) ? base : DEFAULT_LANGUAGE;
}

/** BCP-47 tag used for Intl formatting and the `Accept-Language` request header. */
export function currentLocaleTag(): string {
  return LANGUAGES[currentLanguage()].localeTag;
}

export default i18n;
