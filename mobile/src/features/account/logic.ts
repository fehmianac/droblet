import type { PaletteTone } from '@/api/contracts/account';
import type { CatalogColor } from '@/api/contracts/store';
import type { AppLanguage } from '@/i18n';

/** 29c — the typed word must match the confirmation word, ignoring case in the active language (SİL / sil). */
export function confirmationMatches(input: string, word: string, localeTag: string): boolean {
  return input.trim().toLocaleUpperCase(localeTag) === word.toLocaleUpperCase(localeTag);
}

/** 30 — catalogue colours of the palette's tones, de-duplicated: the colour filter for "Paletime uygun ürünler". */
export function paletteCatalogColors(tones: PaletteTone[]): CatalogColor[] {
  return [...new Set(tones.map((tone) => tone.catalogColor).filter((c): c is CatalogColor => c !== null))];
}

/** Tone names come from the server per language; Turkish is the fallback for a language it does not send yet. */
export function toneName(tone: PaletteTone, language: AppLanguage): string {
  return tone.name[language] ?? tone.name.tr;
}
