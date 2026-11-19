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
  /** Scrim behind bottom sheets / modals (ink at 42%, canvas `.scrim`). */
  scrim: string;
  /** Cream at 0% — start of the cream fade under the welcome collage. */
  creamClear: string;
  /** Cream at 96% — middle stop of the same fade (`Main.dc.html`). */
  creamVeil: string;
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
    scrim: 'rgba(28, 26, 23, 0.42)',
    creamClear: 'rgba(244, 241, 236, 0)',
    creamVeil: 'rgba(244, 241, 236, 0.96)',
  },
};

/**
 * Colours that only live on the ink ground of the toast (canvas 13b): the action label and the error glyph.
 * The palette's accent / danger are too dark to read on ink.
 */
export const onInkTones = {
  action: '#E3D3BF',
  danger: '#F0B4A8',
} as const;

/**
 * The one colour of the logo outside the palette: the small drop inside the "D" on the ink tile
 * (canvas v2 `Logo.dc.html`, direction B). On the cream tile the drop is `accent`.
 */
export const brandTones = {
  dropOnInk: '#B49A80',
} as const;

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

/**
 * Two surfaces the canvas draws outside the palette: the ground of the camera screen (board 12) and the
 * warm "check this" badge on an uncertain AI guess (board 13 "Kategoriyi kontrol et"; ink text on it).
 */
export const surfaceTones = {
  camera: '#2A2622',
  caution: '#F3E3CF',
} as const;

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

/** 12 scan line (canvas `EkleTaniniyor`): the cream line, its soft halo, and the veil over a blurred photo (13). */
export const scanTones = {
  line: '#F4F1EC',
  halo: 'rgba(244, 241, 236, 0.16)',
  haloClear: 'rgba(244, 241, 236, 0)',
  veil: 'rgba(244, 241, 236, 0.3)',
} as const;

/**
 * Piece boxes over the chooser photo (canvas `ParcaSecSecim`): a ticked box is a 2 pt ink line with a light
 * ring so it reads on dark pieces too; an unticked one a light line with a faint ink ring.
 */
export const boxTones = {
  ringLight: 'rgba(244, 241, 236, 0.9)',
  ringDark: 'rgba(28, 26, 23, 0.25)',
  lineLight: 'rgba(251, 249, 245, 0.85)',
} as const;

/** Ink fade under text set on a photograph (20 Keşfet edit cover): ink at 0% → 82%. */
export const inkFade = {
  clear: 'rgba(28, 26, 23, 0)',
  deep: 'rgba(28, 26, 23, 0.82)',
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
  /** 12 scan line: one top → bottom sweep (then back), ease-in-out; fade-out when recognition ends. */
  scanSweepMs: 2000,
  scanFadeMs: 200,
  /** 13 bulk rows: the cleaned image fading in over the blurred photo. */
  cleanFadeMs: 400,
  /** Parçaları seç: stage sentence cross-fade, one box appearing, the list sliding up, the bar finishing. */
  stageFadeMs: 250,
  boxInMs: 280,
  listUpMs: 360,
  barFinishMs: 320,
} as const;

/** Embedded font family names (loaded in `src/app/_layout.tsx`). Custom fonts carry their weight in the family. */
export const fontFamilies = {
  displayMedium: 'CormorantGaramond_500Medium',
  displaySemiBold: 'CormorantGaramond_600SemiBold',
  sans: 'Jost_400Regular',
  sansMedium: 'Jost_500Medium',
  /** Active tab label and count dots only (canvas `.tab.on`, `.dot`). */
  sansSemiBold: 'Jost_600SemiBold',
  googleButton: 'Roboto_500Medium',
} as const;

/** Type scale (BRIEF §3). letterSpacing in RN is absolute points: size × tracking. */
export const typeScale = {
  display: { fontSize: 36, lineHeight: 38, fontFamily: fontFamilies.displayMedium, letterSpacing: -0.36 },
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
  tab: { fontSize: 10.5, lineHeight: 13, fontFamily: fontFamilies.sans, letterSpacing: 0 },
  tabActive: { fontSize: 10.5, lineHeight: 13, fontFamily: fontFamilies.sansSemiBold, letterSpacing: 0 },
  /** Centred title of a pushed screen (canvas headers): Jost 500, 15. */
  title: { fontSize: 15, lineHeight: 20, fontFamily: fontFamilies.sansMedium, letterSpacing: 0 },
  /** Chip label (canvas `.chip`): Jost 400, 13. */
  chip: { fontSize: 13, lineHeight: 18, fontFamily: fontFamilies.sans, letterSpacing: 0 },
  /** Segmented control label: Jost 500, 13.5. */
  segment: { fontSize: 13.5, lineHeight: 18, fontFamily: fontFamilies.sansMedium, letterSpacing: 0 },
  /** Badge (canvas `.badge`): Jost 500, 11. */
  badge: { fontSize: 11, lineHeight: 14, fontFamily: fontFamilies.sansMedium, letterSpacing: 0 },
  /** Label on an image (canvas `.tag`): Jost 500, 9.5, tracking 10%. Written upper-case in the string. */
  tag: { fontSize: 9.5, lineHeight: 12, fontFamily: fontFamilies.sansMedium, letterSpacing: 9.5 * 0.1 },
  /** "EKSİK PARÇA" marker (canvas `.miss`): Jost 500, 9.5, tracking 6%. */
  miss: { fontSize: 9.5, lineHeight: 12, fontFamily: fontFamilies.sansMedium, letterSpacing: 9.5 * 0.06 },
  /** Price (canvas `.price`): Jost 500, 13. */
  price: { fontSize: 13, lineHeight: 18, fontFamily: fontFamilies.sansMedium, letterSpacing: 0 },
  /** Total in the bottom action bar: Jost 500, 17. */
  total: { fontSize: 17, lineHeight: 22, fontFamily: fontFamilies.sansMedium, letterSpacing: 0 },
  /** Field label (canvas `.fld label`): Jost 500, 12. */
  label: { fontSize: 12, lineHeight: 17, fontFamily: fontFamilies.sansMedium, letterSpacing: 0 },
  /** Count dot (canvas `.dot`): Jost 600, 10. */
  dot: { fontSize: 10, lineHeight: 12, fontFamily: fontFamilies.sansSemiBold, letterSpacing: 0 },
} as const;

export type TypeVariant = keyof typeof typeScale;

/** Dynamic Type / font scale cap per variant (BRIEF §3: headings grow up to 130%). */
export const maxFontScale: Partial<Record<TypeVariant, number>> = {
  display: 1.3,
  h2: 1.3,
  h3: 1.3,
  tab: 1.3,
  tabActive: 1.3,
  title: 1.3,
  tag: 1.3,
  miss: 1.3,
  dot: 1.2,
  badge: 1.4,
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
  /** Product-row thumbnail. */
  thumb: 10,
  /** Collage tile on 01. */
  tile: 18,
  field: 12,
  /** ⋯ menu card. */
  menu: 16,
  /** Image tag / missing marker. */
  tag: 6,
  sheet: 28,
  pill: 9999,
} as const;

export const sizes = {
  buttonPrimary: 52,
  buttonSecondary: 44,
  /** Primary button inside the bottom action bar. */
  buttonBar: 48,
  /** Text field (canvas `.inp`). */
  field: 48,
  badge: 22,
  dot: 18,
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
