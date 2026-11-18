/**
 * Logo direction A — "askılı damla": a drop whose counter-space draws a hanger hook
 * (canvas v2 `Logo.dc.html`, `LogoKullanim.dc.html`). Geometry only; colours come from tokens.
 */

/**
 * Box around the whole drop (x 10–42, y 6–52, plus 2 units of air): 36 × 50. The canvas boards use
 * `viewBox="8 4 36 42"`, which cuts the bottom of the drop wherever the SVG clips (it does in
 * react-native-svg), so the app uses the full shape drawn on `Logo.dc.html`.
 * The aspect ratio must never change (LogoKullanim: no stretching, no rotation).
 */
export const MARK_VIEWBOX = '8 4 36 50';
export const MARK_ASPECT = 36 / 50;

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
