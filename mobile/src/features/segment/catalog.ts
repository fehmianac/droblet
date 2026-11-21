import {
  MEN_BODY_TYPES,
  MEN_STYLE_TAGS,
  WOMEN_BODY_TYPES,
  WOMEN_STYLE_TAGS,
  type AppSegment,
  type BodyType,
  type Segment,
  type StyleTag,
} from '@/api/contracts';
import type { ProductCategory } from '@/api/contracts/store';
import { ITEM_CATEGORIES, type ItemCategory } from '@/api/contracts/wardrobe';

/**
 * Canvas 17 "Erkek kullanıcılar" — what changes with the user's segment ("reyon"). Pure: `useSegment()`
 * supplies the segment. The wardrobe itself never changes with it; only suggestions, choices and pictures do.
 */

/** The segment the app serves for a stored value (`teen` is not open: women's set). */
export function appSegment(segment: Segment | null | undefined): AppSegment {
  return segment === 'men' ? 'men' : 'women';
}

/** "Reyon" is asked (onboarding 03a, Profil › Stil profili) only when the server opens more than one. */
export function showSegmentChoice(available: readonly AppSegment[] | null | undefined): boolean {
  return (available?.length ?? 0) > 1;
}

/** 03 — the ten style tags of the segment. */
export function styleTagsFor(segment: AppSegment): readonly StyleTag[] {
  return segment === 'men' ? MEN_STYLE_TAGS : WOMEN_STYLE_TAGS;
}

/** Saved tags that belong to the segment (a segment change keeps the shared ones, e.g. Minimal). */
export function tagsForSegment(tags: readonly StyleTag[], segment: AppSegment): StyleTag[] {
  const allowed = styleTagsFor(segment);
  return tags.filter((tag) => allowed.includes(tag));
}

/** 11e — the six body types of the segment ("Emin değilim" last). */
export function bodyTypesFor(segment: AppSegment): readonly BodyType[] {
  return segment === 'men' ? MEN_BODY_TYPES : WOMEN_BODY_TYPES;
}

/**
 * A saved body type as the requirements engine sees it: one from another segment's set counts as not chosen
 * (asked once more after a segment change). `undefined` (not known yet) passes through.
 */
export function bodyTypeForSegment(type: BodyType | null | undefined, segment: AppSegment): BodyType | null | undefined {
  if (type === undefined || type === null) return type;
  return bodyTypesFor(segment).includes(type) ? type : null;
}

/**
 * 12c "Tür" suggestions per category (server `SubcategoryCatalog` ids, names in `wire/subcategories`).
 * Typing stays free; the chips only fill the field.
 */
const SUBCATEGORY_SUGGESTIONS: Record<AppSegment, Partial<Record<ItemCategory, string[]>>> = {
  women: {
    top: ['t-shirt', 'shirt', 'blouse', 'sweater', 'cardigan', 'top'],
    bottom: ['jeans', 'trousers', 'skirt', 'shorts', 'leggings'],
    dress: ['dress', 'jumpsuit'],
    outerwear: ['blazer', 'jacket', 'coat', 'trench-coat', 'puffer'],
    shoes: ['sneakers', 'boots', 'ankle-boots', 'heels', 'flats', 'loafers'],
    bag: ['handbag', 'tote', 'shoulder-bag', 'crossbody', 'clutch', 'backpack'],
    accessory: ['belt', 'scarf', 'sunglasses', 'necklace', 'earrings', 'watch'],
    beachwear: ['bikini', 'swimsuit', 'kaftan'],
    skiwear: ['ski-jacket', 'ski-pants'],
  },
  men: {
    top: ['t-shirt', 'shirt', 'polo', 'sweater', 'hoodie', 'cardigan'],
    bottom: ['jeans', 'chinos', 'trousers', 'shorts'],
    outerwear: ['suit-jacket', 'blazer', 'jacket', 'coat', 'puffer', 'vest'],
    shoes: ['sneakers', 'loafers', 'oxfords', 'boots', 'sandals'],
    bag: ['backpack', 'crossbody', 'tote'],
    accessory: ['watch', 'tie', 'belt', 'cap', 'sunglasses', 'scarf'],
    beachwear: ['swim-shorts'],
    skiwear: ['ski-jacket', 'ski-pants'],
  },
};

export function subcategorySuggestions(segment: AppSegment, category: ItemCategory | null | undefined): string[] {
  if (!category) return [];
  return SUBCATEGORY_SUGGESTIONS[segment][category] ?? [];
}

/** Wardrobe categories offered for a new choice: men's lists leave "Elbise" out unless it is already in use. */
export function itemCategoriesFor(segment: AppSegment, keep: readonly (ItemCategory | null | undefined)[] = []): ItemCategory[] {
  if (segment === 'women') return [...ITEM_CATEGORIES];
  return ITEM_CATEGORIES.filter((c) => c !== 'dress' || keep.includes(c));
}

/** Catalogue categories that only the women's catalogue has. */
const WOMEN_ONLY_PRODUCT_CATEGORIES: readonly ProductCategory[] = ['dress', 'blouse', 'skirt'];

export function productCategoriesFor(segment: AppSegment, categories: readonly ProductCategory[]): ProductCategory[] {
  return segment === 'men' ? categories.filter((c) => !WOMEN_ONLY_PRODUCT_CATEGORIES.includes(c)) : [...categories];
}

/** 21 — the category chips of the store, in order (men: Jeanler instead of Elbiseler). */
export function shopChipCategories(segment: AppSegment): ProductCategory[] {
  return segment === 'men'
    ? ['tshirt', 'shirt', 'knit', 'jacket', 'trousers', 'jeans', 'accessory']
    : ['tshirt', 'shirt', 'knit', 'jacket', 'trousers', 'dress', 'accessory'];
}
