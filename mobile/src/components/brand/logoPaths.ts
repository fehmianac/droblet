/**
 * Logo direction B — "askı monogramı" (owner decision 2026-11-19): a "D" drawn from a hanger curve, a
 * small drop in its counter, sitting in a rounded square (canvas v2 `Logo.dc.html`, column B).
 * Geometry only; colours come from tokens (`ink`, `cream`, `accent`, `brandTones.dropOnInk`).
 *
 * The canvas draws the mark in a 44 × 44 square at (6, 10) of its lock-up (`viewBox="0 0 210 64"`),
 * the wordmark starting at x = 62 (gap 12) in Cormorant Garamond 500 at 40. The aspect ratio never
 * changes (no stretching, no rotation).
 */
export const MARK_BOX = 44;
export const MARK_VIEWBOX = `6 10 ${MARK_BOX} ${MARK_BOX}`;
export const MARK_ASPECT = 1;
/** Smallest sizes: symbol alone 16 wide, horizontal lock-up 96 wide. */
export const MIN_MARK_WIDTH = 16;
export const MIN_LOCKUP_WIDTH = 96;

/** Minimum empty space around a mark `markWidth` wide: a quarter of the tile (≈ its corner radius). */
export function logoClearSpace(markWidth: number): number {
  return markWidth / 4;
}

/** The rounded square: `<rect x="6" y="10" width="44" height="44" rx="12">`. */
export const TILE = { x: 6, y: 10, size: MARK_BOX, radius: 12 } as const;
/** The same square as a path (inset by half the outline stroke), for stroke-dash drawing. */
export const TILE_OUTLINE_PATH = 'M18 10.7h20A11.3 11.3 0 0 1 49.3 22v20A11.3 11.3 0 0 1 38 53.3H18A11.3 11.3 0 0 1 6.7 42V22A11.3 11.3 0 0 1 18 10.7z';
/** The "D": stem, bowl and the hanger hook leaving the top of the stem. Stroke 2.6, round caps and joins. */
export const D_PATH = 'M20 22v20h6.5a10 10 0 0 0 0-20H20M20 22c0-3 1.6-5 4-5.4';
export const D_STROKE_WIDTH = 2.6;
/** The drop in the D's counter. */
export const DROP_PATH = 'M27 27c0 0-3.2 3.6-3.2 6a3.2 3.2 0 0 0 6.4 0c0-2.4-3.2-6-3.2-6z';

/**
 * Path lengths in viewBox units, used for stroke-dash drawing (react-native-svg has no `pathLength`).
 * Slightly over-estimated on purpose: a dash longer than the path still draws it completely.
 */
export const TILE_LENGTH = 160;
export const D_LENGTH = 76;

/** Standing figure used by the "Üzerimde gör" waiting stage (`AiYukleniyor.dc.html`), viewBox 0 0 60 100. */
export const SILHOUETTE_VIEWBOX = '0 0 60 100';
export const SILHOUETTE_BODY_PATH = 'M17 30c4-4 22-4 26 0l4 32h-7l-2 34h-6l-2-30-2 30h-6l-2-34h-7z';
export const SILHOUETTE_HEAD = { cx: 30, cy: 13, r: 8 } as const;
export const SILHOUETTE_LENGTH = 250;
