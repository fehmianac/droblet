/**
 * Wire shapes of the stylist endpoints (docs/api/wardrobe-looks-plan-stylist.md §6, §9) and the
 * mapping to the app's `StylistOutfitResult`. The wire result carries ids only: piece names and
 * images come from the user's own wardrobe cache, missing pieces from the catalogue.
 */
import i18n from '@/i18n';
import { getActiveQueryClient } from '@/sync/activeClient';

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
import type { Item, ItemCategory } from '../contracts/wardrobe';
import { fetchProductWires, toMoney, type ProductCategoryWire, type ProductWire } from './catalog';
import type { JobWire } from './core';
import {
  fetchItemMap,
  fromOccasion,
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
};

export type OutfitSuggestionWire = {
  index: number;
  /** Null for the rule-based fallback (`source: "rule"`). */
  title: string | null;
  explanation: string | null;
  source: 'model' | 'rule';
  slots: { slot: OutfitSlotWire; itemId: string | null; productId: string | null }[];
  /** Always empty when `onlyMyWardrobe` is true. */
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
    slot: toSlotKind(slot),
    source: 'wardrobe',
    refId: item.id,
    name: item.name,
    brand: item.brand,
    price: null,
    imageUrl: item.imageUrl,
    category: item.category,
    color: item.color,
  };
}

function storePiece(slot: OutfitSlotWire, product: ProductWire, category: ItemCategory | null): StylistPiece {
  return {
    slot: toSlotKind(slot),
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

type Context = { items: Map<string, Item>; products: Map<string, ProductWire> };

export function toStylistSuggestion(
  wire: OutfitSuggestionWire,
  ctx: Context,
  previous?: Pick<StylistSuggestion, 'savedLookId' | 'plannedDate' | 'tryOnImageUrl'>,
): StylistSuggestion {
  const pieces: StylistPiece[] = [];
  for (const slot of wire.slots) {
    const item = slot.itemId ? ctx.items.get(slot.itemId) : undefined;
    const product = !slot.itemId && slot.productId ? ctx.products.get(slot.productId) : undefined;
    // A piece deleted since the job ran is left out; accepting such a draft answers 409 `suggestion_stale`.
    if (item) pieces.push(wardrobePiece(slot.slot, item));
    else if (product) pieces.push(storePiece(slot.slot, product, null));
  }
  for (const missing of wire.missing) {
    // A missing piece without a catalogue match has nothing to show or buy yet.
    const product = missing.productId ? ctx.products.get(missing.productId) : undefined;
    if (product && !pieces.some((p) => p.refId === product.id)) {
      pieces.push(storePiece(missing.slot, product, missing.category ?? SLOT_CATEGORY[missing.slot]));
    }
  }
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
      toStylistSuggestion(s, ctx, previous?.suggestions.find((p) => p.index === s.index)),
    ),
    weather: null,
    refusal,
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
  const [items, products] = await Promise.all([fetchItemMap(), fetchProductWires(productIds)]);
  const client = getActiveQueryClient();
  const previous = client?.getQueryData<Job<StylistOutfitResult>>(['tenant', 'job', job.id])?.result ?? null;
  const request = client?.getQueryData<Pick<StylistOutfitRequest, 'text'>>(['tenant', 'stylist', 'request', job.id]) ?? null;
  return toStylistResult(wire, { items, products }, previous, request);
}
