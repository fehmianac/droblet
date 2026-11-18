/**
 * Logo direction A — "askılı damla": a drop whose counter-space draws a hanger hook
 * (canvas v2 `Logo.dc.html`, `LogoKullanim.dc.html`). Geometry only; colours come from tokens.
 */

/**
 * The mark is drawn in the box every canvas screen uses: `viewBox="8 4 36 42"` (headers 20 × 24,
 * welcome 44 × 52, splash 92 × 108, app icon 104 × 116 in a 180 tile — `LogoIkon`, `LogoKullanim`,
 * `Main`, `Splash`). That box ends at y = 46 while the drop path runs to y = 52, and an SVG clips at
 * its viewport — so on the canvas the drop has a flat base, on every screen and on every icon size.
 * The app reproduces exactly that. (The presentation boards `Logo` and the horizontal lock-up on
 * `LogoKullanim` use a taller box and show the round base; to switch the whole app and the generated
 * icons to that shape, set MARK_BOX_HEIGHT to 50 here and in scripts/render-brand-assets.mjs.)
 * The aspect ratio must never change (LogoKullanim: no stretching, no rotation).
 */
export const MARK_BOX_WIDTH = 36;
export const MARK_BOX_HEIGHT = 42;
export const MARK_VIEWBOX = `8 4 ${MARK_BOX_WIDTH} ${MARK_BOX_HEIGHT}`;
export const MARK_ASPECT = MARK_BOX_WIDTH / MARK_BOX_HEIGHT;
/** Width of the drop itself in viewBox units (x 10–42); clear space is half of it on every side (LogoKullanim). */
export const DROP_WIDTH = 32;
/** Smallest sizes allowed by `LogoKullanim`: symbol alone 16 wide, horizontal lock-up 96 wide. */
export const MIN_MARK_WIDTH = 16;
export const MIN_LOCKUP_WIDTH = 96;

/** Minimum empty space around a mark `markWidth` wide: half the drop's width. */
export function logoClearSpace(markWidth: number): number {
  return ((DROP_WIDTH / MARK_BOX_WIDTH) * markWidth) / 2;
}

export const DROP_PATH = 'M26 6C26 6 10 24 10 36a16 16 0 0 0 32 0C42 24 26 6 26 6z';
export const HOOK_PATH = 'M23.4 27a2.7 2.7 0 1 1 3.8 2.5c-.8.3-1.2.9-1.2 1.7v1.5M26 32.7 15.8 40.6h20.4z';
/** At ≤ 29 px the hook is dropped; only the hanger base stays (LogoIkon). */
export const HANGER_BASE_PATH = 'M26 32.7 15.8 40.6h20.4z';

/**
 * Path lengths in viewBox units, used for stroke-dash drawing (react-native-svg has no `pathLength`).
 * Slightly over-estimated on purpose: a dash longer than the path still draws it completely.
 */
export const DROP_LENGTH = 120;
export const HOOK_LENGTH = 64;

/** Standing figure used by the "Üzerimde gör" waiting stage (`AiYukleniyor.dc.html`), viewBox 0 0 60 100. */
export const SILHOUETTE_VIEWBOX = '0 0 60 100';
export const SILHOUETTE_BODY_PATH = 'M17 30c4-4 22-4 26 0l4 32h-7l-2 34h-6l-2-30-2 30h-6l-2-34h-7z';
export const SILHOUETTE_HEAD = { cx: 30, cy: 13, r: 8 } as const;
export const SILHOUETTE_LENGTH = 250;
