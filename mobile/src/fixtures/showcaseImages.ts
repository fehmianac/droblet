import { Image } from 'react-native';

import { SHOWCASE } from './showcase';

/**
 * Pictures of the showcase build (`EXPO_PUBLIC_DROBLET_FIXTURES=1`): fictional, AI-made editor photographs, look covers
 * and product shots (ops-presets/showcase-*.json, owner approval 2026-11-23), bundled so the fixtures' screens — and
 * the landing's screenshots of them — show real pictures offline. The `item-*` ones are photographs of single
 * pieces supplied by the owner (2026-11-23), not AI-made. The real app never reads them: its pictures come
 * from the API. Under Jest every picture is null, so the placeholder paths stay the tested ones.
 */
const SOURCES = {
  'feed-office': require('../../assets/showcase/feed-office.webp'),
  'feed-weekend': require('../../assets/showcase/feed-weekend.webp'),
  'feed-invite': require('../../assets/showcase/feed-invite.webp'),
  'story-winter': require('../../assets/showcase/story-winter.webp'),
  'story-trench': require('../../assets/showcase/story-trench.webp'),
  'cover-navy-blazer': require('../../assets/showcase/cover-navy-blazer.webp'),
  'cover-black-dress': require('../../assets/showcase/cover-black-dress.webp'),
  'cover-tweed-jean': require('../../assets/showcase/cover-tweed-jean.webp'),
  'cover-cream-layers': require('../../assets/showcase/cover-cream-layers.webp'),
  'cover-friend-dinner': require('../../assets/showcase/cover-friend-dinner.webp'),
  'cover-friend-weekend': require('../../assets/showcase/cover-friend-weekend.webp'),
  'cover-friend-office': require('../../assets/showcase/cover-friend-office.webp'),
  'product-white-shirt': require('../../assets/showcase/product-white-shirt.webp'),
  'product-navy-blazer': require('../../assets/showcase/product-navy-blazer.webp'),
  'product-black-bag': require('../../assets/showcase/product-black-bag.webp'),
  'item-cream-knit': require('../../assets/showcase/item-cream-knit.webp'),
  'item-black-boots': require('../../assets/showcase/item-black-boots.webp'),
  'item-black-turtleneck': require('../../assets/showcase/item-black-turtleneck.webp'),
  'item-beige-trousers': require('../../assets/showcase/item-beige-trousers.webp'),
  'item-suede-bag': require('../../assets/showcase/item-suede-bag.webp'),
  'item-black-belt': require('../../assets/showcase/item-black-belt.webp'),
  'item-blue-knit': require('../../assets/showcase/item-blue-knit.webp'),
  'item-ecru-tee': require('../../assets/showcase/item-ecru-tee.webp'),
  'item-black-skirt': require('../../assets/showcase/item-black-skirt.webp'),
  'item-camel-coat': require('../../assets/showcase/item-camel-coat.webp'),
  'item-check-shirt': require('../../assets/showcase/item-check-shirt.webp'),
} as const;

export type ShowcaseImage = keyof typeof SOURCES;

export function showcaseImage(name: ShowcaseImage | undefined): string | null {
  if (!SHOWCASE || !name) return null;
  return Image.resolveAssetSource(SOURCES[name])?.uri ?? null;
}

/** The pictures that exist among `names`; an empty list when none does (Jest). */
export function showcaseImages(names: readonly ShowcaseImage[]): string[] {
  return names.map(showcaseImage).filter((uri): uri is string => uri !== null);
}
