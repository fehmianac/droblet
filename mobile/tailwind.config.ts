import type { Config } from 'tailwindcss';

import { fontFamilies, palettes, radii, sizes, spacing, typeScale } from './src/theme/tokens';

const c = palettes.light;

/** `text-display`, `text-eyebrow`, … — size, line height and tracking from the type scale. */
const fontSize = Object.fromEntries(
  Object.entries(typeScale).map(([name, v]) => [
    name,
    [`${v.fontSize}px`, { lineHeight: `${v.lineHeight}px`, letterSpacing: `${v.letterSpacing}px` }],
  ]),
) as Record<string, [string, { lineHeight: string; letterSpacing: string }]>;

export default {
  content: ['./src/**/*.{ts,tsx}'],
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        ink: c.ink,
        cream: c.cream,
        paper: c.paper,
        accent: c.accent,
        muted: c.muted,
        line: c.line,
        sand: c.sand,
        danger: c.danger,
        scrim: c.scrim,
      },
      fontSize,
      fontFamily: {
        display: [fontFamilies.displayMedium],
        'display-semibold': [fontFamilies.displaySemiBold],
        sans: [fontFamilies.sans],
        'sans-medium': [fontFamilies.sansMedium],
        'google-button': [fontFamilies.googleButton],
      },
      spacing: {
        gutter: `${spacing.gutter}px`,
        section: `${spacing.section}px`,
        'btn-primary': `${sizes.buttonPrimary}px`,
        'btn-secondary': `${sizes.buttonSecondary}px`,
        'icon-btn': `${sizes.iconButton}px`,
        chip: `${sizes.chip}px`,
        'tab-center': `${sizes.tabBarCenterButton}px`,
      },
      borderRadius: {
        card: `${radii.card}px`,
        image: `${radii.image}px`,
        'image-lg': `${radii.imageLg}px`,
        field: `${radii.field}px`,
        sheet: `${radii.sheet}px`,
        pill: `${radii.pill}px`,
      },
    },
  },
  plugins: [],
} satisfies Config;
