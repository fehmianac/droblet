/**
 * Wire shapes of Renk paletim (30) — docs/api/wardrobe-looks-plan-stylist.md §8 — and the mappers
 * to the app's `Palette`.
 */
import type { Palette, PaletteMismatch, PaletteTone, SeasonType } from '../contracts/account';
import { SEASON_TYPES } from '../contracts/account';
import { CATALOG_COLORS, type CatalogColor } from '../contracts/store';
import type { JobWire } from './core';
import type { ItemWire } from './wardrobe';

/** A reference colour, name already resolved to the request language. */
export type PaletteColorWire = { id: string; family: string; hex: string; name: string };

/** GET v1/tenant/palette → 404 `palette_not_found` when no analysis exists. */
export type PaletteWire = {
  /** Kebab-case reference id, e.g. `warm-autumn`, `bright-spring`. */
  seasonTypeId: string;
  seasonName: string;
  flattering: PaletteColorWire[];
  avoid: PaletteColorWire[];
  /** True → suggest retaking the photo. */
  lowConfidence: boolean;
  /** False → the face photo was replaced since; offer a new analysis. */
  sourcePhotoActive: boolean;
  analyzedAt: string;
  compatibility: {
    /** Null for an empty wardrobe. */
    percent: number | null;
    totalCount: number;
    compatibleCount: number;
    neutralCount: number;
    incompatibleCount: number;
    unmatchedCount: number;
    neutralsCountAsCompatible: boolean;
  };
};

/**
 * POST v1/tenant/palette/analyze `{ requestId }` → 202 `queued` (+ job; result `{ seasonTypeId,
 * lowConfidence }`) or 200 `cached` (+ palette). 422 `face_photo_required`, 403 `premium_required`.
 * Costs no image credit.
 */
export type AnalyzePaletteWire = { requestId: string };
export type AnalyzePaletteResponseWire =
  | { status: 'queued'; palette: null; job: JobWire }
  | { status: 'cached'; palette: PaletteWire; job: null };

/** GET v1/tenant/palette/mismatch → 404 `palette_not_found`. */
export type PaletteMismatchWire = { items: ItemWire[] };

/** `bright-spring` → `bright_spring`; an id the app has no label for falls back to the closest known season. */
export function toSeasonType(seasonTypeId: string): SeasonType {
  const key = seasonTypeId.replace(/-/g, '_');
  if ((SEASON_TYPES as readonly string[]).includes(key)) return key as SeasonType;
  const season = key.split('_').pop();
  return SEASON_TYPES.find((s) => s.endsWith(`_${season}`)) ?? 'warm_autumn';
}

/** Reference colour ids (and families) that are also catalogue filter colours. */
function toCatalogColor(color: PaletteColorWire): CatalogColor | null {
  const known = CATALOG_COLORS as readonly string[];
  if (known.includes(color.id)) return color.id as CatalogColor;
  if (known.includes(color.family)) return color.family as CatalogColor;
  return null;
}

export function toPaletteTone(color: PaletteColorWire): PaletteTone {
  return { id: color.id, hex: color.hex, name: color.name, catalogColor: toCatalogColor(color) };
}

export function toPalette(wire: PaletteWire): Palette {
  return {
    status: 'ready',
    seasonType: toSeasonType(wire.seasonTypeId),
    tones: wire.flattering.map(toPaletteTone),
    avoid: wire.avoid.map(toPaletteTone),
    wardrobeMatchPercent: wire.compatibility.percent,
    lowConfidence: wire.lowConfidence,
    sourcePhotoActive: wire.sourcePhotoActive,
  };
}

export function toPaletteMismatch(wire: PaletteMismatchWire): PaletteMismatch {
  return { items: wire.items.map((i) => ({ id: i.id, name: i.name, imageUrl: i.imageUrl })) };
}
