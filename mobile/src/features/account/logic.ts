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

// ---------- 28 "Profili düzenle" ----------

export const NAME_MAX = 40;
export const HANDLE_MIN = 3;
export const HANDLE_MAX = 30;

/** What the user typed → the handle as it is stored: no "@", no spaces around, lower-case ASCII (İ / I / ı → i). */
export function normalizeHandle(input: string): string {
  return input
    .trim()
    .replace(/^@+/, '')
    .replace(/[İIı]/g, 'i')
    .toLowerCase();
}

export type ProfileFieldError = 'nameRequired' | 'nameTooLong' | 'handleRequired' | 'handleTooShort' | 'handleTooLong' | 'handleInvalid';
export type ProfileErrors = { displayName?: ProfileFieldError; handle?: ProfileFieldError };

/** Field errors of the edit-profile form; an empty object = valid. `handle` is checked after `normalizeHandle`. */
export function validateProfile(input: { displayName: string; handle: string }): ProfileErrors {
  const errors: ProfileErrors = {};
  const name = input.displayName.trim();
  if (name === '') errors.displayName = 'nameRequired';
  else if (name.length > NAME_MAX) errors.displayName = 'nameTooLong';

  const handle = normalizeHandle(input.handle);
  if (handle === '') errors.handle = 'handleRequired';
  else if (!/^[a-z0-9_.]+$/.test(handle)) errors.handle = 'handleInvalid';
  else if (handle.length < HANDLE_MIN) errors.handle = 'handleTooShort';
  else if (handle.length > HANDLE_MAX) errors.handle = 'handleTooLong';
  // The server's shape rule (HandleRules): starts and ends with a letter or digit, no "..".
  else if (!/^[a-z0-9](?:[a-z0-9._]*[a-z0-9])?$/.test(handle) || handle.includes('..')) errors.handle = 'handleInvalid';
  return errors;
}

// ---------- 29b what "delete my photos" removes ----------

export type PhotoDeleteLine =
  | { key: 'bodyAndFace' | 'bodyPhotos' | 'generated'; count: number }
  | { key: 'facePhoto' | 'generatedAll' | 'palette' };

/**
 * The bullet list of 29b, from what the account really has: the photos (one line, as drawn:
 * "1 boy fotoğrafı ve yüz fotoğrafın"), the images generated on the user (the count when the server
 * sends one) and the palette analysis when there is one.
 */
export function photoDeleteLines(
  photos: { body: unknown[]; face: unknown | null; generatedImageCount: number | null } | undefined,
  hasPalette: boolean,
): PhotoDeleteLine[] {
  const lines: PhotoDeleteLine[] = [];
  const body = photos?.body.length ?? 0;
  const face = Boolean(photos?.face);
  if (body > 0 && face) lines.push({ key: 'bodyAndFace', count: body });
  else if (body > 0) lines.push({ key: 'bodyPhotos', count: body });
  else if (face) lines.push({ key: 'facePhoto' });
  const generated = photos?.generatedImageCount ?? null;
  lines.push(generated !== null && generated > 0 ? { key: 'generated', count: generated } : { key: 'generatedAll' });
  if (hasPalette) lines.push({ key: 'palette' });
  return lines;
}

// ---------- 30 swatches ----------

/**
 * A tone close to the paper/cream surface needs the hairline the canvas draws around "Krem" and the
 * icy white. Relative luminance (sRGB) of `#RRGGBB`; anything unreadable counts as not light.
 */
export function isLightTone(hex: string): boolean {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) return false;
  const value = parseInt(match[1], 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel((value >> 16) & 255) + 0.7152 * channel((value >> 8) & 255) + 0.0722 * channel(value & 255);
  return luminance > 0.7;
}

/** The API sends the tone name already in the request language; fixtures carry a per-language map (Turkish fallback). */
export function toneName(tone: PaletteTone, language: AppLanguage): string {
  if (typeof tone.name === 'string') return tone.name;
  return tone.name[language] ?? tone.name.tr;
}
