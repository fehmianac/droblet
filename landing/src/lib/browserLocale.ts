import { defaultLocale, matchLocale, type Locale } from './i18n';

/**
 * Shared links carry no language (`/invite/CODE`, `/reset-password?token=…`) and land on the
 * default-language page. If the browser asks for another registered language, the fallback page moves the
 * visitor to that language's copy, keeping the parameters. A page under `/{locale}/` was chosen explicitly
 * and never moves. Returns the language to move to, or null to stay.
 */
export function browserLocaleTarget(current: Locale): Locale | null {
  if (current !== defaultLocale || typeof navigator === 'undefined') return null;
  const preferred = matchLocale(navigator.languages?.length ? navigator.languages : [navigator.language]);
  return preferred && preferred !== current ? preferred : null;
}
