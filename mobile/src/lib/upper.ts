/**
 * Locale-correct upper-casing for dynamic strings (brand names from the API, dates, cities).
 * Static eyebrow/brand labels are written upper-case in the translation files instead.
 * Never use `textTransform: 'uppercase'` or the `uppercase` class (project rule).
 *
 * `language` is the active app language (`currentLanguage()`); any language without special casing
 * rules uses plain upper-casing, so a new language needs no change here unless it has its own rules.
 *
 * Turkish needs i → İ and ı → I; we map those explicitly instead of trusting the JS engine's
 * locale tables (Hermes support for locale-aware casing varies by platform).
 */
export function toDisplayUpper(value: string, language: string): string {
  if (language === 'tr') {
    return value.replace(/i/g, 'İ').replace(/ı/g, 'I').toUpperCase();
  }
  return value.toUpperCase();
}
