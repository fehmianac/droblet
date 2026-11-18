import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './en.json';
import tr from './tr.json';

export const SUPPORTED_LANGUAGES = ['tr', 'en'] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const resources = {
  tr: { translation: tr },
  en: { translation: en },
} as const;

/** TR is the default; EN is used when the device prefers English. A manual switch comes with screen 29. */
export function detectLanguage(): AppLanguage {
  const code = getLocales()[0]?.languageCode;
  return code === 'en' ? 'en' : 'tr';
}

// eslint-disable-next-line import/no-named-as-default-member -- i18next's documented plugin API
void i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: 'tr',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function currentLanguage(): AppLanguage {
  return i18n.language === 'en' ? 'en' : 'tr';
}

/** BCP-47 tag used for Intl formatting. */
export function currentLocaleTag(): string {
  return currentLanguage() === 'en' ? 'en-GB' : 'tr-TR';
}

export default i18n;
