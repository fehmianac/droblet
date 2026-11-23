import type { Locale } from './i18n';

/**
 * Real app screenshots, one set per language: `public/screens/{locale}/{name}.webp`.
 * Captured from the showcase build of the app (`scripts/capture/README.md`); `npm run check` fails when a
 * file referenced by a page is missing for any language. Alt text and captions live in the dictionaries
 * under `home.screens.{name}`.
 */
export const screenNames = [
  'welcome',
  'segment',
  'feed',
  'today',
  'looks',
  'suggestion',
  'palette',
  'shop',
  'product',
  'friends',
  'membership',
] as const;

export type ScreenName = (typeof screenNames)[number];

/** Pixel size of every exported screenshot (iPhone 17 capture, scaled to 1290 px tall). */
export const screenSize = { width: 593, height: 1290 } as const;

/**
 * Changes with every new capture: the file names stay the same, so without it a browser that saw the page before keeps
 * showing the old screenshots from its cache (they are cached for hours).
 */
export const screenVersion = '2026-11-23b';

export function screenSrc(locale: Locale, name: ScreenName): string {
  return `/screens/${locale}/${name}.webp?v=${screenVersion}`;
}
