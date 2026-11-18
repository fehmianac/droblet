/**
 * Locale-correct upper-casing for dynamic UI text (dates, cities, occasion labels).
 * Brand names are proper nouns and use `toBrandUpper` below — never this function.
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

/**
 * Upper-casing for BRAND NAMES (from the catalogue, the wardrobe, anywhere). A brand keeps its own
 * spelling in every app language, so the casing is locale-independent: "Communité" → "COMMUNITÉ"
 * in Turkish mode too (never "COMMUNİTÉ"), "Lululemon" → "LULULEMON". `String#toUpperCase` uses the
 * Unicode default mapping regardless of the device or app locale; letters a brand already writes
 * with Turkish capitals (İ, I) are kept as they are.
 */
export function toBrandUpper(name: string): string {
  return name.toUpperCase();
}
