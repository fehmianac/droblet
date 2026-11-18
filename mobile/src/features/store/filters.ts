import type { ProductQuery } from '@/api/contracts/store';

/** The three chips above the grid on 21; each shows how many values of its dimension are active. */
export type FilterDimension = 'brand' | 'color' | 'size';

export function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Number of active values of one dimension — shown on its chip ("Marka · 2"). */
export function filterCount(query: ProductQuery, dimension: FilterDimension): number {
  if (dimension === 'brand') return query.brandIds.length;
  if (dimension === 'color') return query.colors.length;
  return query.sizes.length;
}

/**
 * "Temizle" of the "Filtrele" sheet: every choice made in the sheet goes back to its default (no brand,
 * colour or size, newest first). The search text and the category chip live on the screen and are kept.
 */
export function clearSheetFilters(query: ProductQuery): ProductQuery {
  return { ...query, brandIds: [], colors: [], sizes: [], sort: 'newest' };
}
