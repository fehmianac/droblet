import type { Item, ItemCategory, ItemColor, ItemSeason } from '@/api/contracts/wardrobe';

export type ItemSort = 'newest' | 'mostWorn' | 'leastWorn';

/** Brand chip for pieces without a brand ("Diğer"). */
export const BRAND_OTHER = '__other__';

export type ItemFilters = {
  category: ItemCategory | 'all';
  seasons: ItemSeason[];
  colors: ItemColor[];
  /** Brand names, or `BRAND_OTHER`. */
  brands: string[];
  sort: ItemSort;
  search: string;
};

export const DEFAULT_FILTERS: ItemFilters = { category: 'all', seasons: [], colors: [], brands: [], sort: 'newest', search: '' };

/**
 * Case- and diacritic-insensitive key for Turkish text: "İpek", "ipek", "IPEK" and "ıpek" all match.
 * (i / ı / İ / I collapse to "i"; ş ç ğ ü ö lose their marks.)
 */
export function foldTr(value: string): string {
  return value
    .replace(/[İIı]/g, 'i')
    .toLowerCase()
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/** Every word of the query must appear in the name, type, fabric or brand. */
export function matchesSearch(item: Pick<Item, 'name' | 'subcategory' | 'fabric' | 'brand'>, query: string): boolean {
  const words = foldTr(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = foldTr([item.name, item.subcategory, item.fabric, item.brand].filter(Boolean).join(' '));
  return words.every((w) => haystack.includes(w));
}

/** Brands present in the wardrobe, A→Z; `BRAND_OTHER` last when some pieces have no brand. */
export function brandOptions(items: Pick<Item, 'brand'>[]): string[] {
  const names = new Set<string>();
  let hasOther = false;
  for (const item of items) {
    const brand = item.brand?.trim();
    if (brand) names.add(brand);
    else hasOther = true;
  }
  const sorted = [...names].sort((a, b) => foldTr(a).localeCompare(foldTr(b)));
  return hasOther ? [...sorted, BRAND_OTHER] : sorted;
}

function matchesBrand(item: Pick<Item, 'brand'>, brands: string[]): boolean {
  if (brands.length === 0) return true;
  const brand = item.brand?.trim();
  return brand ? brands.includes(brand) : brands.includes(BRAND_OTHER);
}

const SORTERS: Record<ItemSort, (a: Item, b: Item) => number> = {
  // ULIDs sort by time, so the id breaks ties between pieces created in the same batch.
  newest: (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  mostWorn: (a, b) => b.wearCount - a.wearCount || a.name.localeCompare(b.name),
  leastWorn: (a, b) => a.wearCount - b.wearCount || a.name.localeCompare(b.name),
};

/** Filter + sort on the device (GET v1/tenant/item returns everything; works offline from cache). */
export function applyFilters(items: Item[], filters: ItemFilters): Item[] {
  return items
    .filter(
      (item) =>
        (filters.category === 'all' || item.category === filters.category) &&
        (filters.seasons.length === 0 || item.seasons.some((s) => filters.seasons.includes(s))) &&
        (filters.colors.length === 0 || filters.colors.includes(item.color)) &&
        matchesBrand(item, filters.brands) &&
        matchesSearch(item, filters.search),
    )
    .sort(SORTERS[filters.sort]);
}

/** Filters set in the sheet (category chips and search are shown separately). */
export function sheetFilterCount(filters: ItemFilters): number {
  return filters.seasons.length + filters.colors.length + filters.brands.length + (filters.sort === 'newest' ? 0 : 1);
}

export function isFiltering(filters: ItemFilters): boolean {
  return filters.category !== 'all' || filters.search.trim() !== '' || filters.seasons.length + filters.colors.length + filters.brands.length > 0;
}

export function toggleIn<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
