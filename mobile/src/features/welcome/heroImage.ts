import type { AppSegment } from '@/api/contracts';

/**
 * The welcome photo (canvas 20 · Karşılama, direction A). Bundled, so the screen never waits on the network;
 * chosen before sign-in from `segments.available` of the anonymous `GET v1/config`.
 */
export type WelcomeHero = 'mixed' | 'women' | 'men' | 'group';

export const WELCOME_HEROES: Record<WelcomeHero, number> = {
  mixed: require('../../../assets/welcome/welcome-mixed-1.webp'),
  women: require('../../../assets/welcome/welcome-woman-1.webp'),
  men: require('../../../assets/welcome/welcome-man-1.webp'),
  group: require('../../../assets/welcome/welcome-mixed-2.webp'),
};

/** SE-class phones (667 pt): board 20d — value line hidden, headline 32, the studio group photo. */
export const COMPACT_WELCOME_MAX_HEIGHT = 700;

export function isCompactWelcome(windowHeight: number): boolean {
  return windowHeight > 0 && windowHeight < COMPACT_WELCOME_MAX_HEIGHT;
}

/**
 * Which photo: both segments open → the couple (20a), or the studio group on small phones (20d); women only → 20b;
 * men only → 20c (on every phone size: a women-only launch never shows a man). Config missing or failed
 * (`segments` undefined) → women, the phase 1 default.
 */
export function welcomeHero(segments: readonly AppSegment[] | undefined, windowHeight: number): WelcomeHero {
  const women = segments?.includes('women') ?? false;
  const men = segments?.includes('men') ?? false;
  if (women && men) return isCompactWelcome(windowHeight) ? 'group' : 'mixed';
  if (men) return 'men';
  return 'women';
}
