/**
 * Wire shapes of Keşfet content, catalogue, cart, watch list, checkout and purchase prompts
 * (docs/api/store-social-settings.md §2–§4) and the mappers to the app types in
 * `../contracts/store`. `ProductWire` itself lives in `./catalog` (shared with looks / stylist).
 */
import type {
  Brand,
  BuilderSlot,
  CatalogColor,
  Cart,
  CheckoutResponse,
  CompleteSuggestions,
  CreateLookRequest,
  CreatorCard,
  ProductCategory,
  ProductMatch,
  ProductPage,
  ProductQuery,
  ProductSize,
  ProductSort,
  ProductSummary,
  PurchasePrompt,
  SeriesOutfit,
  StoreLookRef,
  TryOnState,
  Watchlist,
  WatchlistEntry,
  WeeklyEditSummary,
} from '../contracts/store';
import { CATALOG_COLORS, ONE_SIZE } from '../contracts/store';
import { toMoney, type LookRefWire, type ProductCategoryWire, type ProductSlotWire, type ProductWire } from './catalog';
import { toCamel, toSnake, type JobWire } from './core';
import type { ItemWire, OutfitSlotWire } from './wardrobe';

// ---------- products ----------

/** A catalogue colour slug the app knows (the placeholder ground), null for anything else. */
export function toCatalogColorOrNull(color: string | null | undefined): CatalogColor | null {
  return color && (CATALOG_COLORS as readonly string[]).includes(color) ? (color as CatalogColor) : null;
}

/** The app spells one category differently (`knit` is its translation key). */
export function toProductCategory(category: ProductCategoryWire): ProductCategory {
  return category === 'knitwear' ? 'knit' : category;
}

export function fromProductCategory(category: ProductCategory): ProductCategoryWire {
  return category === 'knit' ? 'knitwear' : category;
}

export function toProductSummary(wire: ProductWire): ProductSummary {
  return {
    id: wire.id,
    brandId: wire.brandId,
    brandName: wire.brandName,
    brandLogoUrl: null,
    name: wire.name,
    price: toMoney(wire.priceMinor, wire.currency),
    previousPrice: toMoney(wire.previousPriceMinor, wire.currency),
    imageUrl: wire.images[0] ?? null,
    category: toProductCategory(wire.category),
    colors: wire.colors,
    // A product without sizes (bags, accessories) is one-size on the device.
    sizes: wire.sizes.length > 0 ? wire.sizes : [ONE_SIZE],
    sizesOnBrandSite: wire.sizes.length === 0 && wire.sizesOnBrandSite === true,
    available: wire.available,
    description: wire.description,
    priceBand: toSnake(wire.priceBand),
  };
}

/** The size to send: nothing for a one-size product (the server refuses a size it does not sell). */
export function fromProductSize(size: ProductSize | null | undefined): string | undefined {
  return size && size !== ONE_SIZE ? size : undefined;
}

/** GET v1/catalog/product */
export type ProductPageWire = { items: ProductWire[]; pageToken: string | null; count: number };

export function fromProductSort(sort: ProductSort): string {
  return toCamel(sort);
}

type ServerFilters = { category?: string; brand?: string; color?: string; size?: string };

/**
 * Splits the app's multi-select query into what the server can do (one value per filter) and what
 * the device has to do (filters with several values).
 */
export function splitProductQuery(query: ProductQuery): { server: ServerFilters; local: (p: ProductSummary) => boolean } {
  const server: ServerFilters = {};
  const checks: ((p: ProductSummary) => boolean)[] = [];
  if (query.categories.length === 1) server.category = fromProductCategory(query.categories[0]);
  else if (query.categories.length > 1) checks.push((p) => query.categories.includes(p.category));
  if (query.brandIds.length === 1) server.brand = query.brandIds[0];
  else if (query.brandIds.length > 1) checks.push((p) => query.brandIds.includes(p.brandId));
  if (query.colors.length === 1) server.color = query.colors[0];
  else if (query.colors.length > 1) checks.push((p) => p.colors.some((c) => (query.colors as string[]).includes(c)));
  if (query.sizes.length === 1) server.size = fromProductSize(query.sizes[0]);
  else if (query.sizes.length > 1) checks.push((p) => p.sizes.some((s) => query.sizes.includes(s)));
  return { server, local: (p) => checks.every((check) => check(p)) };
}

export function toProductPage(wire: ProductPageWire, keep: (p: ProductSummary) => boolean = () => true): ProductPage {
  return { items: wire.items.map(toProductSummary).filter(keep), nextPageToken: wire.pageToken, count: wire.count };
}

// ---------- brands and content ----------

export type BrandWire = { id: string; name: string; logoUrl: string | null; websiteUrl: string | null };

export function toBrand(wire: BrandWire): Brand {
  return { id: wire.id, name: wire.name, logoUrl: wire.logoUrl, websiteUrl: wire.websiteUrl };
}

/** GET v1/content/edit/current — only what the Keşfet cover needs is typed here. */
export type EditWire = {
  id: string;
  title: string;
  subtitle: string | null;
  coverImageUrl: string | null;
  weekStart: string;
  weekEnd: string;
  segment: string;
  sponsored: boolean;
  sponsorName: string | null;
  looks: { id: string; day: number; imageUrl: string | null }[];
};

export function toWeeklyEditSummary(wire: EditWire): WeeklyEditSummary {
  return {
    id: wire.id,
    title: wire.title,
    startDate: wire.weekStart,
    endDate: wire.weekEnd,
    lookCount: wire.looks.length,
    imageUrl: wire.coverImageUrl ?? wire.looks.find((l) => l.imageUrl)?.imageUrl ?? null,
  };
}

/** GET v1/content/creator · GET v1/content/series-outfit */
export type ContentCollectionWire = {
  id: string;
  kind: 'creator' | 'series';
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  sponsored: boolean;
  sponsorName: string | null;
  /** The creator's Droblet @handle when the account exists (creators only; older servers omit it). */
  handle?: string | null;
};

/** A creator collection is editorial content; `handle` links it to the creator's account when there is one. No role. */
export function toCreatorCard(wire: ContentCollectionWire): CreatorCard {
  return {
    id: wire.id,
    handle: wire.handle ? wire.handle.replace(/^@/, '') : null,
    displayName: wire.title,
    role: null,
    lookTitle: wire.subtitle ?? '',
    imageUrl: wire.imageUrl,
    sponsored: wire.sponsored,
  };
}

export function toSeriesOutfit(wire: ContentCollectionWire): SeriesOutfit {
  return { id: wire.id, title: wire.title, seriesName: wire.subtitle ?? '', imageUrl: wire.imageUrl };
}

// ---------- wardrobe match / complete ----------

export type ProductMatchWire = {
  productId: string;
  compatibleCount: number;
  items: { id: string; name: string; category: string; colors: string[]; imageUrl: string | null }[];
};

export function toProductMatch(wire: ProductMatchWire): ProductMatch {
  return {
    count: wire.compatibleCount,
    items: wire.items.map((i) => ({ id: i.id, name: i.name, imageUrl: i.imageUrl, category: i.category, color: i.colors[0] ?? null })),
  };
}

/** POST v1/tenant/catalog/complete */
export type CompleteWire = { slots: { slot: ProductSlotWire; products: ProductWire[] }[] };

export function toCompleteSuggestions(wire: CompleteWire): CompleteSuggestions {
  const seen = new Set<string>();
  const products: ProductSummary[] = [];
  for (const slot of wire.slots) {
    for (const product of slot.products) {
      if (seen.has(product.id)) continue;
      seen.add(product.id);
      products.push(toProductSummary(product));
    }
  }
  return { products };
}

// ---------- item from product ----------

/** POST v1/tenant/item/from-product → 201 / 200 with one result row. */
export type ItemCreateResultWire = {
  refId: string;
  outcome: 'created' | 'alreadyApplied' | 'rejected';
  code: string | null;
  errors: Record<string, string[]> | null;
  item: ItemWire | null;
};

// ---------- outfit builder → look ----------

const BUILDER_SLOT_WIRE: Record<BuilderSlot, OutfitSlotWire> = {
  top: 'top',
  bottom: 'bottom',
  outerwear: 'outerwear',
  shoes: 'shoes',
  bag: 'bagAccessory',
};

export type CreateLookWire = {
  id: string;
  name: string;
  occasion: string | null;
  slots: { slot: OutfitSlotWire; itemId?: string; productId?: string }[];
  favorite: boolean;
  source: 'builder';
};

export function fromBuilderLook(look: CreateLookRequest): CreateLookWire {
  return {
    id: look.id,
    name: look.name,
    occasion: look.occasion,
    slots: look.slots.map((s) =>
      s.source === 'store'
        ? { slot: BUILDER_SLOT_WIRE[s.slot], productId: s.productId }
        : { slot: BUILDER_SLOT_WIRE[s.slot], itemId: s.itemId },
    ),
    favorite: false,
    source: 'builder',
  };
}

// ---------- try-on of a product ----------

export type TryOnImageWire = { id: string; url: string; urlExpiresAt: string; createdAt: string };
/** POST v1/tenant/tryon → 200 (`cached`) or 202 (`queued`). */
export type TryOnStartWire = { status: 'cached' | 'queued'; image: TryOnImageWire | null; job: JobWire | null };

export function toTryOnState(image: TryOnImageWire | null): TryOnState {
  return image ? { status: 'done', imageUrl: image.url } : { status: 'none', imageUrl: null };
}

// ---------- cart ----------

export type CartLineWire = { lineId: string; product: ProductWire; size: string; look: LookRefWire | null; addedAt: string };
export type CartGroupWire = { brandId: string; brandName: string; lines: CartLineWire[]; subtotalMinor: number };
export type CartWire = { groups: CartGroupWire[]; lineCount: number; totalMinor: number; currency: string };

export function toCart(wire: CartWire): Cart {
  return {
    groups: wire.groups.map((g) => ({
      brandId: g.brandId,
      brandName: g.brandName,
      brandLogoUrl: null,
      subtotal: toMoney(g.subtotalMinor, wire.currency),
      lines: g.lines.map((l) => ({
        lineId: l.lineId,
        productId: l.product.id,
        name: l.product.name,
        size: l.size,
        // A retired product stays in the cart but adds nothing: it is shown without a price.
        price: l.product.available ? toMoney(l.product.priceMinor, l.product.currency) : null,
        imageUrl: l.product.images[0] ?? null,
        available: l.product.available,
        category: toProductCategory(l.product.category),
        color: toCatalogColorOrNull(l.product.colors[0]),
      })),
    })),
    total: wire.lineCount > 0 ? toMoney(wire.totalMinor, wire.currency) : null,
    lineCount: wire.lineCount,
  };
}

export type CartLineInputWire = { clientMutationId?: string; productId: string; size?: string; look?: LookRefWire };

export function fromCartLine(line: { clientMutationId: string; productId: string; size?: ProductSize; look?: StoreLookRef }): CartLineInputWire {
  const wire: CartLineInputWire = { clientMutationId: line.clientMutationId, productId: line.productId };
  const size = fromProductSize(line.size);
  if (size) wire.size = size;
  if (line.look) wire.look = line.look;
  return wire;
}

export type CheckoutWire = {
  clickId: string;
  /** Open in the in-app browser. */
  url: string;
  source: 'network' | 'direct';
  brandId: string;
  brandName: string;
  products: { productId: string; url: string }[];
};

export function toCheckout(wire: CheckoutWire): CheckoutResponse {
  return { checkoutUrl: wire.url, clickId: wire.clickId };
}

// ---------- watch list ----------

export type WatchItemWire = {
  product: ProductWire;
  size: string | null;
  look: LookRefWire | null;
  priceAtAddMinor: number;
  currentPriceMinor: number;
  priceDropped: boolean;
  dropMinor: number;
  addedAt: string;
  /** The price-drop bell of this product (absent on older servers = on). */
  notify?: boolean;
  /** `auto` = added by the server after a brand visit without a purchase. */
  origin?: 'user' | 'auto';
};

export function toWatchlistEntry(wire: WatchItemWire): WatchlistEntry {
  const product = toProductSummary(wire.product);
  return {
    productId: product.id,
    brandId: product.brandId,
    brandName: product.brandName,
    brandLogoUrl: null,
    name: product.name,
    price: toMoney(wire.currentPriceMinor, wire.product.currency),
    // "Dropped" compares with the price when the user started watching.
    previousPrice: wire.priceDropped ? toMoney(wire.priceAtAddMinor, wire.product.currency) : null,
    imageUrl: product.imageUrl,
    category: product.category,
    colors: product.colors,
    sizes: product.sizes,
    alertEnabled: wire.notify ?? true,
    // The wire carries only the look's id, not its name: a user look reads as "from a look" without one.
    source:
      wire.origin === 'auto'
        ? { kind: 'auto' }
        : wire.look
          ? wire.look.kind === 'user'
            ? { kind: 'look', lookName: '' }
            : { kind: 'edit' }
          : { kind: 'manual' },
  };
}

export function toWatchlist(wire: WatchItemWire[]): Watchlist {
  return { items: wire.map((w) => toWatchlistEntry(w)) };
}

// ---------- purchase prompt ----------

export type PurchasePromptWire = {
  id: string;
  brandId: string;
  brandName: string;
  products: ProductWire[];
  look: LookRefWire | null;
  status: 'none' | 'pending' | 'accepted' | 'dismissed';
  receivedAt: string;
};
/** PUT v1/tenant/purchase-prompt/{id} `{ accepted }` — the server adds the pieces itself. */
export type PurchasePromptAnswerWire = { status: 'accepted' | 'dismissed'; items: ItemCreateResultWire[] };

export function toPurchasePrompt(wire: PurchasePromptWire): PurchasePrompt {
  return {
    id: wire.id,
    brandId: wire.brandId,
    brandName: wire.brandName,
    products: wire.products.map(toProductSummary),
    receivedAt: wire.receivedAt,
  };
}
