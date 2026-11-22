import type { Config } from 'tailwindcss';

import { feedTones, fontFamilies, onPhotoTones, palettes, radii, sizes, spacing, typeScale } from './src/theme/tokens';

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
        'onPhoto-ground': onPhotoTones.ground,
        'onPhoto-text': onPhotoTones.text,
        'onPhoto-legal': onPhotoTones.legal,
        'onPhoto-outline': onPhotoTones.outline,
        'onPhoto-glass': onPhotoTones.glass,
        'feed-line': feedTones.cardLine,
        'feed-owned': feedTones.owned,
        'feed-dot': feedTones.dotOff,
        'feed-thumb': feedTones.thumb,
        'feed-body': feedTones.body,
        'feed-counter': feedTones.counter,
        'feed-chip': feedTones.chipOnPhoto,
        'feed-pill': feedTones.pillOnPhoto,
        'feed-story-card': feedTones.storyCard,
        'feed-story-track': feedTones.storyTrack,
      },
      fontSize,
      fontFamily: {
        display: [fontFamilies.displayMedium],
        'display-semibold': [fontFamilies.displaySemiBold],
        sans: [fontFamilies.sans],
        'sans-medium': [fontFamilies.sansMedium],
        'sans-semibold': [fontFamilies.sansSemiBold],
        'google-button': [fontFamilies.googleButton],
      },
      spacing: {
        gutter: `${spacing.gutter}px`,
        section: `${spacing.section}px`,
        'btn-primary': `${sizes.buttonPrimary}px`,
        'btn-secondary': `${sizes.buttonSecondary}px`,
        'btn-bar': `${sizes.buttonBar}px`,
        field: `${sizes.field}px`,
        badge: `${sizes.badge}px`,
        dot: `${sizes.dot}px`,
        'tab-bar': `${sizes.tabBar}px`,
        'icon-btn': `${sizes.iconButton}px`,
        chip: `${sizes.chip}px`,
        'tab-center': `${sizes.tabBarCenterButton}px`,
      },
      borderRadius: {
        card: `${radii.card}px`,
        image: `${radii.image}px`,
        'image-lg': `${radii.imageLg}px`,
        field: `${radii.field}px`,
        thumb: `${radii.thumb}px`,
        tile: `${radii.tile}px`,
        menu: `${radii.menu}px`,
        tag: `${radii.tag}px`,
        sheet: `${radii.sheet}px`,
        pill: `${radii.pill}px`,
      },
    },
  },
  plugins: [],
} satisfies Config;
