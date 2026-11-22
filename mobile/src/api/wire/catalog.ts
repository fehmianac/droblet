/**
 * Wire shape of a catalogue product (`ProductDto`, docs/api/store-social-settings.md §1) and the
 * cached single-product read other features use to resolve a `productId` (look slots, missing
 * pieces, stylist suggestions). The store feature maps `ProductWire` to its own card types.
 */
import type { Money } from '@/lib/format';
import { getActiveQueryClient } from '@/sync/activeClient';

import { apiRequest } from '../client';
import { ApiError } from '../errors';

export type PriceBandWire = 'highStreet' | 'luxuryTouch';

/** Catalogue categories (18) — finer than the wardrobe's `ItemCategory`. */
export type ProductCategoryWire =
  | 'tshirt'
  | 'shirt'
  | 'blouse'
  | 'knitwear'
  | 'sweatshirt'
  | 'jacket'
  | 'coat'
  | 'trousers'
  | 'jeans'
  | 'skirt'
  | 'shorts'
  | 'dress'
  | 'shoes'
  | 'bag'
  | 'accessory'
  | 'swimwear'
  | 'skiwear'
  | 'activewear';

/** Catalogue slot of a product (not the look slot: `bag` / `accessory` / `onePiece` exist here). */
export type ProductSlotWire = 'top' | 'bottom' | 'outerwear' | 'shoes' | 'bag' | 'onePiece' | 'accessory';

export type ProductWire = {
  id: string;
  brandId: string;
  brandName: string;
  /** Already resolved to the request language. */
  name: string;
  description: string | null;
  category: ProductCategoryWire;
  slot: ProductSlotWire;
  colors: string[];
  /** May be empty (bags, accessories) → one size. */
  sizes: string[];
  priceMinor: number;
  currency: string;
  /** Only when the last price change was a drop. */
  previousPriceMinor: number | null;
  priceBand: PriceBandWire;
  images: string[];
  /** false = retired ("stokta yok"); still resolvable. */
  available: boolean;
  createdAt: string;
};

/** `{ kind, id }` — where an add-to-cart / watch / checkout came from. */
export type LookRefWire = { kind: 'edit' | 'collection' | 'user' | 'feedPost'; id: string };

export function toMoney(amountMinor: number | null | undefined, currency: string | null | undefined): Money | null {
  if (amountMinor === null || amountMinor === undefined || !currency) return null;
  return { amountMinor, currency };
}

export const productWireKey = (id: string) => ['catalog', 'product-wire', id] as const;

async function requestProduct(id: string): Promise<ProductWire | null> {
  try {
    return await apiRequest<ProductWire>(`v1/catalog/product/${encodeURIComponent(id)}`);
  } catch (e) {
    // Unknown id: the slot is shown without product details rather than failing the whole read.
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** `GET v1/catalog/product/{id}` through the query cache (5 minutes); null when the product is unknown. */
export function fetchProductWire(id: string): Promise<ProductWire | null> {
  const client = getActiveQueryClient();
  if (!client) return requestProduct(id);
  return client.fetchQuery({ queryKey: productWireKey(id), queryFn: () => requestProduct(id), staleTime: 5 * 60_000 });
}

/** Resolves several product ids at once (duplicates and nulls ignored). */
export async function fetchProductWires(ids: (string | null | undefined)[]): Promise<Map<string, ProductWire>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const found = await Promise.all(unique.map((id) => fetchProductWire(id)));
  const map = new Map<string, ProductWire>();
  found.forEach((p) => {
    if (p) map.set(p.id, p);
  });
  return map;
}
