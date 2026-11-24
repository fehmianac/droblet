/**
 * Wire shapes of the stylist endpoints (docs/api/wardrobe-looks-plan-stylist.md §6, §9) and the
 * mapping to the app's `StylistOutfitResult`. The wire result carries ids only: piece names and
 * images come from the user's own wardrobe cache, missing pieces from the catalogue.
 */
import i18n from '@/i18n';
import { imageVariantsOf } from '@/lib/images';
import { segmentStore } from '@/features/segment/store';
import { getActiveQueryClient } from '@/sync/activeClient';
import { queryKeys } from '@/sync/queryKeys';

import { apiRequest } from '../client';
import type { LibraryItem } from '../contracts';

import type { Job } from '../contracts/jobs';
import type {
  AcceptSuggestionRequest,
  AcceptSuggestionResponse,
  StylistDislikeReason,
  StylistOutfitRequest,
  StylistOutfitResult,
  StylistPiece,
  StylistRefusal,
  StylistSuggestion,
} from '../contracts/stylist';
import type { Item, ItemCategory, ItemColor } from '../contracts/wardrobe';
import { fetchProductWires, toMoney, type ProductCategoryWire, type ProductWire } from './catalog';
import type { JobWire } from './core';
import {
  fetchItemMap,
  fromOccasion,
  toItemColor,
  toOccasion,
  toSlotKind,
  type LookWire,
  type OccasionWire,
  type OutfitSlotWire,
} from './wardrobe';

// ---------- requests ----------

/** POST v1/tenant/stylist/outfit → 202 `JobWire`. Only `requestId` and `date` are required. */
export type StylistOutfitRequestWire = {
  requestId: string;
  date: string;
  occasion: OccasionWire | null;
  /** ≤ 200 chars. */
  freeText: string | null;
  onlyMyWardrobe: boolean;
  /** "Bununla kombin yap". */
  pinnedItemId: string | null;
  cityId: string | null;
  latitude: number | null;
  longitude: number | null;
};

export function fromStylistRequest(request: StylistOutfitRequest): StylistOutfitRequestWire {
  return {
    requestId: request.requestId,
    date: request.date,
    occasion: fromOccasion(request.occasion),
    freeText: request.text,
    onlyMyWardrobe: request.wardrobeOnly,
    pinnedItemId: request.itemIds?.[0] ?? null,
    cityId: request.cityId,
    latitude: null,
    longitude: null,
  };
}

/** POST v1/tenant/stylist/suggestion/{jobId}/{index}/accept */
export type AcceptSuggestionWire = {
  clientMutationId: string;
  lookId: string | null;
  name: string | null;
  planDate: string | null;
  favorite: boolean;
};
/** `planDay` is the wire PlanDayDto (only its date is needed here). */
export type AcceptedSuggestionWire = { look: LookWire; planDay: { date: string; lookId: string | null } | null };

export function fromAcceptSuggestion(request: AcceptSuggestionRequest): AcceptSuggestionWire {
  return {
    clientMutationId: request.clientMutationId,
    lookId: request.lookId,
    name: null,
    planDate: request.date,
    favorite: false,
  };
}

export function toAcceptedSuggestion(wire: AcceptedSuggestionWire): AcceptSuggestionResponse {
  return { lookId: wire.look.id, plannedDate: wire.planDay?.date ?? null };
}

export type DislikeReasonWire = 'notMyStyle' | 'wrongOccasion' | 'wrongWeather' | 'colorMismatch' | 'wornTooOften' | 'other';

const DISLIKE: Record<StylistDislikeReason, DislikeReasonWire> = {
  occasion: 'wrongOccasion',
  colors: 'colorMismatch',
  piece: 'notMyStyle',
  weather: 'wrongWeather',
  too_formal: 'notMyStyle',
};

/** The wire takes one reason: the first chip picked, `other` when none. */
export function fromDislikeReasons(reasons: StylistDislikeReason[]): DislikeReasonWire {
  const first = reasons[0];
  return first ? DISLIKE[first] : 'other';
}

// ---------- job result ----------

export type MissingPieceReasonWire = 'emptySlot' | 'rain' | 'cold' | 'noShoes' | 'suggested';
export type MissingPieceWire = {
  slot: OutfitSlotWire;
  category: ItemCategory | null;
  reason: MissingPieceReasonWire;
  /** Null until the catalogue matches a product. */
  productId: string | null;
  /** A ready-made library piece picked to fill the slot (thin wardrobe); absent on older servers. */
  libraryItemId?: string | null;
};

export type OutfitSuggestionWire = {
  index: number;
  /** Null for the rule-based fallback (`source: "rule"`). */
  title: string | null;
  explanation: string | null;
  source: 'model' | 'rule';
  slots: { slot: OutfitSlotWire; itemId: string | null; productId: string | null }[];
  /** System-picked pieces of a thin wardrobe (library / catalogue) — also when `onlyMyWardrobe` is true. */
  missing: MissingPieceWire[];
};

/** Result of a `stylistOutfit` job. */
export type OutfitResultWire = {
  date: string;
  occasion: OccasionWire | null;
  onlyMyWardrobe: boolean;
  refusal: string | null;
  language: string;
  suggestions: OutfitSuggestionWire[];
  /** True when some pieces were picked by Droblet (library / catalogue) to complete the outfits. */
  gapFilled?: boolean;
};

/** Catalogue category → wardrobe category (the server's own mapping, docs §3 "from-product"). */
const PRODUCT_TO_ITEM_CATEGORY: Record<ProductCategoryWire, ItemCategory> = {
  tshirt: 'top',
  shirt: 'top',
  blouse: 'top',
  knitwear: 'top',
  sweatshirt: 'top',
  activewear: 'top',
  trousers: 'bottom',
  jeans: 'bottom',
  skirt: 'bottom',
  shorts: 'bottom',
  jacket: 'outerwear',
  coat: 'outerwear',
  dress: 'dress',
  swimwear: 'beachwear',
  skiwear: 'skiwear',
  shoes: 'shoes',
  bag: 'bag',
  accessory: 'accessory',
};

export function toItemCategory(category: ProductCategoryWire | null | undefined): ItemCategory {
  return (category && PRODUCT_TO_ITEM_CATEGORY[category]) || 'accessory';
}

const SLOT_CATEGORY: Record<OutfitSlotWire, ItemCategory> = {
  top: 'top',
  bottom: 'bottom',
  outerwear: 'outerwear',
  shoes: 'shoes',
  bagAccessory: 'accessory',
};

function wardrobePiece(slot: OutfitSlotWire, item: Item): StylistPiece {
  return {
    slot: toSlotKind(slot, item.category),
    source: 'wardrobe',
    refId: item.id,
    name: item.name,
    brand: item.brand,
    price: null,
    imageUrl: item.imageUrl,
    ...imageVariantsOf(item),
    category: item.category,
    color: item.color,
  };
}

function storePiece(slot: OutfitSlotWire, product: ProductWire, category: ItemCategory | null): StylistPiece {
  return {
    slot: toSlotKind(slot, category ?? toItemCategory(product.category)),
    source: 'store',
    refId: product.id,
    name: product.name,
    brand: product.brandName,
    price: toMoney(product.priceMinor, product.currency),
    imageUrl: product.images[0] ?? null,
    category: category ?? toItemCategory(product.category),
    color: null,
  };
}

type LibraryRowWire = { id: string; name: string; category: string; subcategory?: string | null; colorIds: string[]; imageUrl: string | null };

async function requestLibrary(): Promise<LibraryItem[]> {
  const rows = await apiRequest<LibraryRowWire[]>('v1/tenant/library/item');
  return rows.map((w) => ({
    id: w.id,
    name: w.name,
    category: w.category,
    subcategory: w.subcategory ?? null,
    imageUrl: w.imageUrl ?? null,
    color: w.colorIds?.[0] ? toItemColor(w.colorIds[0]) : null,
  }));
}

/** The ready-made library by id (names / pictures of the pieces the stylist picked); the cached list when there is one. */
export async function fetchLibraryMap(): Promise<Map<string, LibraryItem>> {
  const client = getActiveQueryClient();
  const segment = segmentStore.get();
  const list = client
    ? await client.fetchQuery({ queryKey: queryKeys.libraryFor(segment), queryFn: requestLibrary, staleTime: 5 * 60_000 })
    : await requestLibrary();
  return new Map(list.map((i) => [i.id, i]));
}

function libraryPiece(slot: OutfitSlotWire, item: LibraryItem, category: ItemCategory | null): StylistPiece {
  return {
    slot: toSlotKind(slot, category ?? item.category),
    source: 'library',
    suggested: true,
    refId: item.id,
    name: item.name,
    brand: null,
    price: null,
    imageUrl: item.imageUrl,
    category: category ?? (item.category as ItemCategory),
    color: (item.color as ItemColor | null | undefined) ?? null,
  };
}

type Context = { items: Map<string, Item>; products: Map<string, ProductWire>; library?: Map<string, LibraryItem> };

/**
 * The missing pieces of one outfit as rows: a library pick the user already added shows as their own piece,
 * one not added yet as "Önerilen · Kütüphane", a catalogue pick as a store piece. Shared by outfit, week and trip.
 */
export function missingPieces(missing: readonly MissingPieceWire[], ctx: Context, taken: readonly StylistPiece[], suggested: boolean): StylistPiece[] {
  const pieces: StylistPiece[] = [];
  const owned = new Map<string, Item>();
  for (const item of ctx.items.values()) if (item.libraryItemId) owned.set(item.libraryItemId, item);
  for (const m of missing) {
    const has = (id: string) => taken.some((p) => p.refId === id) || pieces.some((p) => p.refId === id);
    if (m.libraryItemId) {
      const mine = owned.get(m.libraryItemId);
      const lib = ctx.library?.get(m.libraryItemId);
      if (mine && !has(mine.id)) pieces.push(wardrobePiece(m.slot, mine));
      else if (!mine && lib && !has(lib.id)) pieces.push(libraryPiece(m.slot, lib, m.category ?? SLOT_CATEGORY[m.slot]));
      continue;
    }
    // A missing piece without a catalogue match has nothing to show or buy yet.
    const product = m.productId ? ctx.products.get(m.productId) : undefined;
    if (product && !has(product.id)) pieces.push({ ...storePiece(m.slot, product, m.category ?? SLOT_CATEGORY[m.slot]), ...(suggested ? { suggested: true } : {}) });
  }
  return pieces;
}

export function toStylistSuggestion(
  wire: OutfitSuggestionWire,
  ctx: Context,
  previous?: Pick<StylistSuggestion, 'savedLookId' | 'plannedDate' | 'tryOnImageUrl'>,
  suggested = false,
): StylistSuggestion {
  const pieces: StylistPiece[] = [];
  for (const slot of wire.slots) {
    const item = slot.itemId ? ctx.items.get(slot.itemId) : undefined;
    const product = !slot.itemId && slot.productId ? ctx.products.get(slot.productId) : undefined;
    // A piece deleted since the job ran is left out; accepting such a draft answers 409 `suggestion_stale`.
    if (item) pieces.push(wardrobePiece(slot.slot, item));
    else if (product) pieces.push(storePiece(slot.slot, product, null));
  }
  pieces.push(...missingPieces(wire.missing, ctx, pieces, suggested));
  return {
    index: wire.index,
    // The rule-based fallback has no AI text: the app's own neutral wording is shown instead.
    name: wire.title ?? i18n.t('stylistResult.ruleTitle', { number: wire.index + 1 }),
    note: wire.explanation ?? i18n.t('stylistResult.ruleNote'),
    pieces,
    tryOnImageUrl: previous?.tryOnImageUrl ?? null,
    savedLookId: previous?.savedLookId ?? null,
    plannedDate: previous?.plannedDate ?? null,
  };
}

const REFUSALS: readonly StylistRefusal[] = ['insufficient_wardrobe', 'out_of_scope'];

export function toStylistResult(
  wire: OutfitResultWire,
  ctx: Context,
  previous?: StylistOutfitResult | null,
  request?: Pick<StylistOutfitRequest, 'text'> | null,
): StylistOutfitResult {
  const refusal = REFUSALS.find((r) => r === wire.refusal) ?? (wire.refusal ? 'out_of_scope' : null);
  return {
    request: {
      date: wire.date,
      occasion: toOccasion(wire.occasion),
      text: request?.text ?? previous?.request.text ?? null,
      wardrobeOnly: wire.onlyMyWardrobe,
    },
    suggestions: (wire.suggestions ?? []).map((s) =>
      toStylistSuggestion(s, ctx, previous?.suggestions.find((p) => p.index === s.index), wire.gapFilled === true),
    ),
    weather: null,
    refusal,
    gapFilled: wire.gapFilled === true,
  };
}

/**
 * `mapResult` of the stylist job: joins the wire result with the wardrobe cache and the catalogue.
 * What the user did with a suggestion on this device (saved / planned) is kept across re-reads of
 * the job — the job result itself never changes.
 */
export async function mapStylistResult(result: unknown, job: JobWire): Promise<StylistOutfitResult> {
  const wire = result as OutfitResultWire;
  const productIds = (wire.suggestions ?? []).flatMap((s) => [
    ...s.slots.map((x) => (x.itemId ? null : x.productId)),
    ...s.missing.map((m) => m.productId),
  ]);
  const needsLibrary = (wire.suggestions ?? []).some((s) => s.missing.some((m) => m.libraryItemId));
  const [items, products, library] = await Promise.all([fetchItemMap(), fetchProductWires(productIds), needsLibrary ? fetchLibraryMap() : Promise.resolve(undefined)]);
  const client = getActiveQueryClient();
  const previous = client?.getQueryData<Job<StylistOutfitResult>>(['tenant', 'job', job.id])?.result ?? null;
  const request = client?.getQueryData<Pick<StylistOutfitRequest, 'text'>>(['tenant', 'stylist', 'request', job.id]) ?? null;
  return toStylistResult(wire, { items, products, library }, previous, request);
}
