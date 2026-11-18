/**
 * Droblet design tokens — the single source for colour, type, spacing and radii
 * (BRIEF §3, README §7). `tailwind.config.ts` reads this file; components never contain hex values.
 *
 * Colour is defined per palette. Phase 1 ships `light` only (no dark mode, README §9.1 / A-9).
 * To add dark later: add `dark: ColorPalette` to `palettes` and switch the NativeWind theme on
 * colour scheme — every component already consumes semantic names, not hex.
 */

export type ColorPalette = {
  /** Main text, primary button, selected chip, active tab. */
  ink: string;
  /** Screen background; text on dark surfaces. */
  cream: string;
  /** Cards, fields, tab bar, bottom action bar, sheets. */
  paper: string;
  /** Badges, progress, cart count, store-sourced piece label, "Senin üzerinde". */
  accent: string;
  /** Secondary text, eyebrow. */
  muted: string;
  /** Card border, divider, chip border. */
  line: string;
  /** Segmented control background, info box, image placeholder. */
  sand: string;
  /** Errors and destructive actions — always paired with text. */
  danger: string;
  /** Scrim behind bottom sheets / modals (ink at 40%). */
  scrim: string;
  /** Cream at 0% — start of the cream fade under the welcome collage. */
  creamClear: string;
};

export const palettes: { light: ColorPalette } = {
  light: {
    ink: '#1C1A17',
    cream: '#F4F1EC',
    paper: '#FBF9F5',
    accent: '#6E5640',
    muted: '#665F56',
    line: '#DCD4C9',
    sand: '#E8E1D7',
    danger: '#9A3B2E',
    scrim: 'rgba(28, 26, 23, 0.4)',
    creamClear: 'rgba(244, 241, 236, 0)',
  },
};

/**
 * Third-party brand colours that must not be re-themed (Google sign-in button brand rules,
 * UX_DESIGNER §Marka butonları). Used only by the Google button.
 */
export const thirdPartyColors = {
  googleSurface: '#FFFFFF',
  googleBorder: '#747775',
  googleText: '#1F1F1F',
  googleBlue: '#4285F4',
  googleGreen: '#34A853',
  googleYellow: '#FBBC05',
  googleRed: '#EA4335',
} as const;

/**
 * Neutral tones for image placeholders and the AI loading language (canvas v2 `AiYukleniyor*`):
 * stand-ins for garment colours while the real image is not there yet. Never used for text or UI chrome.
 */
export const placeholderTones = {
  stage: '#DDD3C6',
  dark: '#3A342E',
  taupe: '#A89582',
  oat: '#D6CBBE',
  clay: '#CDBFAE',
  camel: '#BFAE99',
} as const;
export type PlaceholderTone = keyof typeof placeholderTones;

/** Swatches for wardrobe colour families (filter sheet, colour picker). Keys = `ItemColor` in api/contracts/wardrobe. */
export const garmentColors = {
  black: '#1C1A17',
  white: '#FFFFFF',
  beige: '#D8C7AE',
  navy: '#2F3A4F',
  brown: '#7A4E3A',
  grey: '#9B9892',
  cream: '#EFE6D6',
  blue: '#5B7A99',
  green: '#5E6B4E',
  red: '#8C3B3B',
  pink: '#D9A7A0',
  other: '#C9B79C',
} as const;

/** Shimmer highlight of the AI loading language: paper at 0% → 45% → 0%. */
export const sheen = {
  clear: 'rgba(251, 249, 245, 0)',
  peak: 'rgba(251, 249, 245, 0.45)',
} as const;

/** Motion constants shared by the splash and the AI loading language (README §11). */
export const motion = {
  /** cubic-bezier(0.2, 0.8, 0.2, 1) */
  bezier: [0.2, 0.8, 0.2, 1] as const,
  splashTotalMs: 2600,
  shimmerMs: 1800,
  traceMs: 3200,
  pieceStaggerMs: 300,
  lineIntervalMs: 2000,
} as const;

/** Embedded font family names (loaded in `src/app/_layout.tsx`). Custom fonts carry their weight in the family. */
export const fontFamilies = {
  displayMedium: 'CormorantGaramond_500Medium',
  displaySemiBold: 'CormorantGaramond_600SemiBold',
  sans: 'Jost_400Regular',
  sansMedium: 'Jost_500Medium',
  googleButton: 'Roboto_500Medium',
} as const;

/** Type scale (BRIEF §3). letterSpacing in RN is absolute points: size × tracking. */
export const typeScale = {
  display: { fontSize: 36, lineHeight: 38, fontFamily: fontFamilies.displayMedium, letterSpacing: 0 },
  h2: { fontSize: 26, lineHeight: 29, fontFamily: fontFamilies.displayMedium, letterSpacing: 0 },
  h3: { fontSize: 20, lineHeight: 23, fontFamily: fontFamilies.displaySemiBold, letterSpacing: 0 },
  body: { fontSize: 14, lineHeight: 21, fontFamily: fontFamilies.sans, letterSpacing: 0 },
  bodyMedium: { fontSize: 14, lineHeight: 21, fontFamily: fontFamilies.sansMedium, letterSpacing: 0 },
  caption: { fontSize: 12, lineHeight: 17, fontFamily: fontFamilies.sans, letterSpacing: 0 },
  /** Eyebrow: Jost 500, 11, tracking 14%. Text is written upper-case in the translation file, never transformed. */
  eyebrow: { fontSize: 11, lineHeight: 15, fontFamily: fontFamilies.sansMedium, letterSpacing: 11 * 0.14 },
  /** Brand: Jost 500, 10.5, tracking 12%. Dynamic brand names go through `toDisplayUpper`. */
  brand: { fontSize: 10.5, lineHeight: 14, fontFamily: fontFamilies.sansMedium, letterSpacing: 10.5 * 0.12 },
  button: { fontSize: 15, lineHeight: 20, fontFamily: fontFamilies.sansMedium, letterSpacing: 0 },
  tab: { fontSize: 10.5, lineHeight: 13, fontFamily: fontFamilies.sansMedium, letterSpacing: 0 },
} as const;

export type TypeVariant = keyof typeof typeScale;

/** Dynamic Type / font scale cap per variant (BRIEF §3: headings grow up to 130%). */
export const maxFontScale: Partial<Record<TypeVariant, number>> = {
  display: 1.3,
  h2: 1.3,
  h3: 1.3,
  tab: 1.3,
  eyebrow: 1.6,
  brand: 1.6,
};

/** 4 pt grid. Tailwind's default spacing scale is already 4-based; these are the named extras. */
export const spacing = {
  gutter: 20,
  section: 24,
} as const;

export const radii = {
  card: 20,
  image: 12,
  imageLg: 14,
  field: 12,
  sheet: 28,
  pill: 9999,
} as const;

export const sizes = {
  buttonPrimary: 52,
  buttonSecondary: 44,
  iconButton: 44,
  chip: 36,
  touchMin: 44,
  /** Tab bar height including the bottom safe area (BRIEF §3). */
  tabBar: 86,
  tabBarCenterButton: 56,
  tabBarCenterRaise: 18,
  iconStroke: 1.5,
  icon: 22,
} as const;
