import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './en.json';
import { featureResources } from './features';
import tr from './tr.json';

/**
 * Language registry. Adding a language = its locale file(s) + one entry here (and one in
 * `features/index.ts` for the per-feature files). `tag` is the BCP-47 tag used for Intl formatting;
 * `name` is the language's own name, shown in the language switch (29).
 */
export const LANGUAGES = {
  tr: { tag: 'tr-TR', name: 'Türkçe', translation: { ...tr, ...featureResources.tr } },
  en: { tag: 'en-GB', name: 'English', translation: { ...en, ...featureResources.en } },
} as const;

export type AppLanguage = keyof typeof LANGUAGES;
export const SUPPORTED_LANGUAGES = Object.keys(LANGUAGES) as AppLanguage[];
export const DEFAULT_LANGUAGE: AppLanguage = 'tr';

export function isAppLanguage(value: string | null | undefined): value is AppLanguage {
  return typeof value === 'string' && value in LANGUAGES;
}

export const resources = {
  tr: { translation: LANGUAGES.tr.translation },
  en: { translation: LANGUAGES.en.translation },
} as const;

/** First launch: the device language when the app supports it, otherwise TR. The manual switch (29) lives in `./preference`. */
export function detectLanguage(): AppLanguage {
  const code = getLocales()[0]?.languageCode;
  return isAppLanguage(code) ? code : DEFAULT_LANGUAGE;
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
  return isAppLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;
}

/** BCP-47 tag used for Intl formatting. */
export function currentLocaleTag(): string {
  return LANGUAGES[currentLanguage()].tag;
}

export default i18n;
