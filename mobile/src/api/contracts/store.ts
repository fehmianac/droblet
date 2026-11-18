import type { Money } from '@/lib/format';

/**
 * E8 — Keşfet, mağaza, ürün, kombin oluşturucu, sepet, izleme listesi (20–24b).
 *
 * These are the APP types the screens render. The wire shapes (docs/api/store-social-settings.md) and
 * the mappers between the two live in `../wire/store.ts`; the hooks in `features/store` convert at the
 * API boundary. Amounts are `Money` = integer minor units + ISO currency code.
 */

// ---------- Content (20) ----------

/** GET v1/content/edit/current (`EditDto`: weekStart / weekEnd / coverImageUrl / looks[]) → 404 `not_found` when no edit is published. */
export type WeeklyEditSummary = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  lookCount: number;
  imageUrl: string | null;
};

/**
 * GET v1/content/creator → `ContentCollectionDto[]` (id, title, subtitle, imageUrl, sponsored). A collection
 * is not a user account: `handle` and `role` are always null from the API, `displayName` is the collection
 * title and `lookTitle` its subtitle. `sponsored` drives the "Sponsorlu" label.
 */
export type CreatorCard = {
  id: string;
  /** Without the leading @. Null for brand showcases. */
  handle: string | null;
  displayName: string;
  /** e.g. "Stil danışmanı"; shown with "yer tutucu" on 27. */
  role: string | null;
  lookTitle: string;
  imageUrl: string | null;
  sponsored: boolean;
};

/** GET v1/content/series-outfit → `ContentCollectionDto[]` (`seriesName` = the collection subtitle); empty until the licence decision (A-7). */
export type SeriesOutfit = { id: string; title: string; seriesName: string; imageUrl: string | null };

// ---------- Catalogue (21, 22) ----------

/**
 * The 18 catalogue categories. Same spelling as the wire except `knit` (wire `knitwear`), which is
 * the app's translation key.
 */
export const PRODUCT_CATEGORIES = [
  'tshirt',
  'shirt',
  'blouse',
  'knit',
  'sweatshirt',
  'jacket',
  'coat',
  'trousers',
  'jeans',
  'skirt',
  'shorts',
  'dress',
  'shoes',
  'bag',
  'accessory',
  'swimwear',
  'skiwear',
  'activewear',
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const CATALOG_COLORS = [
  'white',
  'black',
  'navy',
  'beige',
  'brown',
  'cream',
  'olive',
  'burgundy',
  'grey',
  'camel',
] as const;
export type CatalogColor = (typeof CATALOG_COLORS)[number];

/** Wire: `newest` | `priceAsc` | `priceDesc`. */
export const PRODUCT_SORTS = ['newest', 'price_asc', 'price_desc'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

/** Size label as the brand sells it ("S", "38"); `ONE` = one size ("Tek beden"). */
export type ProductSize = string;
export const ONE_SIZE = 'ONE';

/** GET v1/catalog/brand */
/**
 * `logoUrl` is the brand's official logo as supplied through the catalogue; when absent the app
 * shows the brand name in the brand text style (see `BrandMark`).
 */
export type Brand = { id: string; name: string; logoUrl?: string | null; websiteUrl?: string | null };

export type ProductSummary = {
  id: string;
  brandId: string;
  brandName: string;
  brandLogoUrl?: string | null;
  name: string;
  /** Null when the brand has not published a price. */
  price: Money | null;
  imageUrl: string | null;
  category: ProductCategory;
  /** Catalogue colour slugs (free-form on the wire; the filter sheet offers `CATALOG_COLORS`). */
  colors: string[];
  /** `[ONE_SIZE]` for a product sold without sizes (wire `sizes: []`). */
  sizes: ProductSize[];
  /** Set when the last price change was a drop. */
  previousPrice?: Money | null;
  /** false = retired ("stokta yok"); still shown, cannot be bought. Absent = available. */
  available?: boolean;
  description?: string | null;
  priceBand?: 'high_street' | 'luxury_touch';
};

/**
 * GET v1/catalog/product?category=&brand=&color=&size=&priceBand=&q=&sort=&pageToken=&limit=
 * The server takes ONE value per filter. The app's filters are multi-select: a filter with exactly
 * one value is sent to the server; a filter with several values is left out of the request and
 * applied to each returned page on the device (pages can then be shorter than the page size; the
 * infinite list keeps following `pageToken`). Slot pickers ask one first page per category instead.
 */
export type ProductQuery = {
  categories: ProductCategory[];
  brandIds: string[];
  colors: CatalogColor[];
  sizes: ProductSize[];
  q: string;
  sort: ProductSort;
};
/** Wire `{ items, pageToken, count }`; `count` = total matches on the server. */
export type ProductPage = { items: ProductSummary[]; nextPageToken: string | null; count?: number };

/** GET v1/catalog/product/{id} */
export type ProductDetail = ProductSummary;

/** GET v1/tenant/catalog/product/{id}/match → `{ productId, compatibleCount, items[] }`. */
export type ProductMatch = {
  count: number;
  /** Wardrobe pieces; `category` / `color` (wardrobe vocabulary, optional) draw the placeholder while there is no picture. */
  items: { id: string; name: string; imageUrl: string | null; category?: string | null; color?: string | null }[];
};

/** GET v1/tenant/favorite/product → `{ productIds }` (the heart on product cards; separate from the watch list). */
export type FavoriteProducts = { productIds: string[] };
/** PUT (favourite) / DELETE (remove) v1/tenant/favorite/product/{productId} → 204; no body. */
export type SetFavoriteRequest = { productId: string; favorite: boolean; clientMutationId: string };

/** POST v1/tenant/item/from-product — "Gardıroba ekle" (22). 201 created / 200 replay; 404 `product_not_found`. `ONE` is sent without a size. */
export type AddItemFromProductRequest = { clientMutationId: string; productId: string; size: ProductSize };

// ---------- Outfit builder (23); wardrobe pieces are `Item`s from `./wardrobe` ----------

export const BUILDER_SLOTS = ['top', 'bottom', 'outerwear', 'shoes', 'bag'] as const;
export type BuilderSlot = (typeof BUILDER_SLOTS)[number];

/**
 * "Parçamı tamamla" — `POST v1/tenant/catalog/complete { itemIds, priceBand?, size? }` (synchronous,
 * rule based, no credit) → `{ slots: [{ slot, products }] }`; the app shows the products of every
 * slot in one strip.
 */
export type CompleteSuggestions = { products: ProductSummary[] };

// ---------- Try-on of a product (22 "Üzerimde") ----------

/** GET v1/tenant/tryon?kind=product&id= → `TryOnImageDto` (the owner's existing image) or 404 = none. */
export type TryOnState = {
  status: 'none' | 'pending' | 'done' | 'failed';
  /** Private, short-lived signed URL — never persisted. */
  imageUrl: string | null;
};
/**
 * POST v1/tenant/tryon `{ requestId, target: { kind: "product", id } }` → 200 `{ status: "cached", image }` or
 * 202 `{ status: "queued", job }` (poll `GET v1/tenant/job/{id}`, then `GET v1/tenant/tryon/{tryOnImageId}`).
 * 402 `credits_exhausted`, 403 `premium_required`, 422 `body_photo_required`, 404 `target_not_found`.
 */
export type TryOnRequest = { requestId: string; clientMutationId: string; target: { kind: 'product'; id: string } };

// ---------- Outfit builder (23) ----------

/**
 * POST v1/tenant/look — the subset the builder writes. Sent as `{ id, name, occasion, slots: [{ slot, itemId |
 * productId }], favorite: false, source: "builder" }`; the builder's `bag` slot is the wire `bagAccessory`.
 * 201 / 200 (same id again); 422 `look_min_pieces`, `slot_category_mismatch`, `slot_item_not_found`, `slot_product_not_found`, …
 */
export type CreateLookRequest = {
  id: string;
  clientMutationId: string;
  name: string;
  occasion: null;
  slots: ({ slot: BuilderSlot; source: 'wardrobe'; itemId: string } | { slot: BuilderSlot; source: 'store'; productId: string })[];
};

// ---------- Cart (24) ----------

export type CartLine = {
  lineId: string;
  productId: string;
  name: string;
  size: ProductSize;
  price: Money | null;
  imageUrl: string | null;
  /** false = the product was retired; it stays in the cart but adds nothing to the totals. */
  available?: boolean;
  /** Category / main colour of the product, when the cart carries them: glyph and ground of the placeholder while there is no picture. */
  category?: ProductCategory | null;
  color?: CatalogColor | null;
};
export type CartGroup = { brandId: string; brandName: string; brandLogoUrl?: string | null; subtotal: Money | null; lines: CartLine[] };
/** GET v1/tenant/cart (`CartDto`) — grouped by brand, priced with the current catalogue price on every read. */
export type Cart = { groups: CartGroup[]; total: Money | null; lineCount: number };

/** Where an add-to-cart / watch / checkout came from (wire `LookRef`). */
export type StoreLookRef = { kind: 'edit' | 'collection' | 'user'; id: string };

/**
 * POST v1/tenant/cart/line (1–20 lines, all or nothing) → the cart. 404 `product_not_found`, 422
 * `product_retired` / `size_not_available` / `cart_full`. Re-adding product + size keeps the line.
 */
export type AddCartLinesRequest = {
  lines: { clientMutationId: string; productId: string; size?: ProductSize; look?: StoreLookRef }[];
};
/** DELETE v1/tenant/cart/line/{lineId} */
export type RemoveCartLineRequest = { lineId: string; clientMutationId: string };

/**
 * POST v1/tenant/cart/checkout/{brandId} (brand group) · POST v1/tenant/catalog/product/{id}/checkout (one
 * product) → `CheckoutDto`; `checkoutUrl` is its `url`. 422 `cart_empty` / `product_retired` /
 * `affiliate_link_missing`, 404 `brand_not_found` / `product_not_found`.
 */
export type CheckoutResponse = { checkoutUrl: string; clickId: string };

// ---------- Watch list (24b) — GET / PUT / DELETE v1/tenant/watch-list[/{productId}] ----------

export type WatchlistEntry = {
  productId: string;
  brandId: string;
  brandName: string;
  brandLogoUrl?: string | null;
  name: string;
  price: Money | null;
  /** Set when the price dropped since the product was added. */
  previousPrice: Money | null;
  imageUrl: string | null;
  category: ProductCategory;
  colors: string[];
  sizes: ProductSize[];
  /** The bell: a price drop is pushed for this product (`WatchItemDto.notify`; also needs the `priceDrop` preference). */
  alertEnabled: boolean;
  /**
   * Where the entry came from: a look's missing piece, the weekly edit, added by hand, or put there by
   * the server after a brand visit without a purchase (`origin: "auto"`, 48 h after the checkout click).
   */
  source: { kind: 'look'; lookName: string } | { kind: 'edit' } | { kind: 'manual' } | { kind: 'auto' };
};
/** GET v1/tenant/watch-list → `WatchItemDto[]`, newest first. */
export type Watchlist = { items: WatchlistEntry[] };
/**
 * PUT v1/tenant/watch-list/{productId} `{ size?, look?, notify }` (404 `product_not_found`, 422 `product_retired` /
 * `watch_list_full`; on an existing entry only the sent fields change) · DELETE v1/tenant/watch-list/{productId} → 204.
 */
export type SetWatchRequest = {
  productId: string;
  watching: boolean;
  alertEnabled: boolean;
  clientMutationId: string;
  size?: ProductSize;
  look?: StoreLookRef;
};

// ---------- Purchase prompt ("Gardıroba ekleyelim mi?") ----------

/** GET v1/tenant/purchase-prompt → pending prompts created by a conversion postback. */
export type PurchasePrompt = { id: string; brandId: string; brandName: string; products: ProductSummary[]; receivedAt: string };
