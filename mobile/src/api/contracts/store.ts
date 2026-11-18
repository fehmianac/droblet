import type { Money } from '@/lib/format';

/**
 * E8 — Keşfet, mağaza, ürün, kombin oluşturucu, sepet, izleme listesi (20–24b).
 *
 * ⚠ PROVISIONAL — shapes assumed from the endpoint map in BACKEND_ENGINEER.md while the backend is
 * written in parallel. Endpoints marked "ASSUMED" are not in that map yet and need confirming.
 * Conventions as in `../contracts.ts` (camelCase JSON, UTC ISO times, `YYYY-MM-DD` dates, TRY amounts
 * as `Money` = integer minor units + ISO currency code, every write idempotent on `clientMutationId`).
 */

// ---------- Content (20) ----------

/** GET v1/content/edit/current → 404 when no edit is published. */
export type WeeklyEditSummary = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  lookCount: number;
  imageUrl: string | null;
};

/** GET v1/content/creator → creators with their featured look. `sponsored` drives the "Sponsorlu" label. */
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

/** GET v1/content/series-outfit → empty until the licence decision (A-7). */
export type SeriesOutfit = { id: string; title: string; seriesName: string; imageUrl: string | null };

// ---------- Catalogue (21, 22) ----------

export const PRODUCT_CATEGORIES = [
  'tshirt',
  'shirt',
  'knit',
  'jacket',
  'trousers',
  'dress',
  'accessory',
  'shoes',
  'bag',
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
export type Brand = { id: string; name: string; logoUrl?: string | null };

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
  colors: CatalogColor[];
  sizes: ProductSize[];
};

/**
 * GET v1/catalog/product?category=&brand=&color=&size=&q=&sort=&pageToken=
 * Assumption: multi-value filters are comma-separated; `category` accepts several values (used for
 * the outfit-builder slots).
 */
export type ProductQuery = {
  categories: ProductCategory[];
  brandIds: string[];
  colors: CatalogColor[];
  sizes: ProductSize[];
  q: string;
  sort: ProductSort;
};
export type ProductPage = { items: ProductSummary[]; nextPageToken: string | null };

/** GET v1/catalog/product/{id} */
export type ProductDetail = ProductSummary;

/** GET v1/tenant/catalog/product/{id}/match */
export type ProductMatch = { count: number; items: { id: string; name: string; imageUrl: string | null }[] };

/** ASSUMED: GET v1/tenant/favorite/product (the heart on product cards; separate from the watchlist). */
export type FavoriteProducts = { productIds: string[] };
/** ASSUMED: PUT v1/tenant/favorite/product/{productId} */
export type SetFavoriteRequest = { productId: string; favorite: boolean; clientMutationId: string };

/** POST v1/tenant/item/from-product — "Gardıroba ekle" (22). */
export type AddItemFromProductRequest = { clientMutationId: string; productId: string; size: ProductSize };

// ---------- Wardrobe pieces used by 21 "Parçamı tamamla" and 23 ----------

export const BUILDER_SLOTS = ['top', 'bottom', 'outerwear', 'shoes', 'bag'] as const;
export type BuilderSlot = (typeof BUILDER_SLOTS)[number];

/**
 * Minimal view of GET v1/tenant/item (E2, owned by the Gardırop work). Replace with the shared
 * wardrobe hook once that contract lands.
 */
export type WardrobePiece = {
  id: string;
  name: string;
  /** Builder slot the piece fits, when it fits one. */
  slot: BuilderSlot | null;
  imageUrl: string | null;
};

/**
 * POST v1/tenant/stylist/complete { requestId, itemIds } — "Parçamı tamamla".
 * Assumption: modelled as a direct product list; the map describes a 202 job, to be wired to the
 * shared job polling when E5 lands.
 */
export type CompleteSuggestions = { products: ProductSummary[] };

// ---------- Try-on of a product (22 "Üzerimde") ----------

/** GET v1/tenant/tryon?kind=product&id= → the owner's existing image for this target, if any. */
export type TryOnState = {
  status: 'none' | 'pending' | 'done' | 'failed';
  /** Private, short-lived signed URL — never persisted. */
  imageUrl: string | null;
};
/** POST v1/tenant/tryon → 202; 422 `body_photo_required`; `credits_exhausted` when the month's credits are used. */
export type TryOnRequest = { requestId: string; clientMutationId: string; target: { kind: 'product'; id: string } };

// ---------- Outfit builder (23) ----------

/** POST v1/tenant/look (E3) — the subset the builder writes. */
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
};
export type CartGroup = { brandId: string; brandName: string; brandLogoUrl?: string | null; subtotal: Money | null; lines: CartLine[] };
/** GET v1/tenant/cart — grouped by brand, priced with the current catalogue price. */
export type Cart = { groups: CartGroup[]; total: Money | null; lineCount: number };

/** POST v1/tenant/cart/line */
export type AddCartLinesRequest = { lines: { clientMutationId: string; productId: string; size: ProductSize }[] };
/** DELETE v1/tenant/cart/line/{lineId} */
export type RemoveCartLineRequest = { lineId: string; clientMutationId: string };

/** POST v1/tenant/cart/checkout/{brandId} → the brand's own checkout (affiliate link with click id). */
export type CheckoutResponse = { checkoutUrl: string; clickId: string };

// ---------- Watchlist (24b) — ASSUMED endpoints ----------

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
  colors: CatalogColor[];
  sizes: ProductSize[];
  alertEnabled: boolean;
  /** Where the entry came from: a look's missing piece, the weekly edit, or added by hand. */
  source: { kind: 'look'; lookName: string } | { kind: 'edit' } | { kind: 'manual' };
};
/** ASSUMED: GET v1/tenant/watchlist */
export type Watchlist = { items: WatchlistEntry[] };
/** ASSUMED: PUT v1/tenant/watchlist/{productId} (add / alert toggle) · DELETE v1/tenant/watchlist/{productId} */
export type SetWatchRequest = { productId: string; watching: boolean; alertEnabled: boolean; clientMutationId: string };
