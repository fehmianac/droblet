/**
 * Wire shapes of wardrobe items and looks (`ItemDto`, `LookDto`, docs/api/wardrobe-looks-plan-stylist.md
 * §3–§4) and the mappers to the app types. Shared by every feature that shows a piece or a look
 * (wardrobe, looks, today / plan, stylist, trips, palette).
 *
 * The wire is normalised: a look slot carries only `itemId` / `productId`. The app's `LookSlot` also
 * has the name, image, brand and price, so `toLook` joins with the wardrobe (cached `GET
 * v1/tenant/item`) and the catalogue (`GET v1/catalog/product/{id}`).
 */
import i18n from '@/i18n';
import { getActiveQueryClient } from '@/sync/activeClient';

import { apiRequest } from '../client';
import type { Occasion } from '../contracts';
import type { Look, LookSlot, LookSlotInput, LookSlotKind } from '../contracts/looks';
import {
  ITEM_COLORS,
  type DraftField,
  type Item,
  type ItemCategory,
  type ItemColor,
  type ItemDetail,
  type ItemDraft,
  type ItemSeason,
} from '../contracts/wardrobe';
import { fetchProductWires, toMoney, type ProductWire } from './catalog';
import type { JobWire, PresignedPostWire } from './core';

// ---------- items ----------

export type ItemSourceWire = 'photo' | 'library' | 'purchase';

export type ItemWire = {
  id: string;
  name: string;
  category: ItemCategory;
  /** Reference colour ids (`GET v1/tenant/reference/wardrobe`); `[0]` is the main colour. */
  colorIds: string[];
  fabric: string | null;
  seasons: ItemSeason[];
  size: string | null;
  brand: string | null;
  source: ItemSourceWire;
  productId: string | null;
  libraryItemId: string | null;
  /** Short-lived presigned GET (cleaned image, or the original when `useOriginalImage`). */
  imageUrl: string | null;
  imageUrlExpiresAt: string | null;
  hasOriginalImage: boolean;
  useOriginalImage: boolean;
  wearCount: number;
  lastWornAt: string | null;
  listingStatus: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

/** Reference colour id → colour family, for ids the app's filter list does not carry. */
const COLOR_FAMILY: Record<string, ItemColor> = {
  charcoal: 'grey',
  silver: 'grey',
  ivory: 'white',
  taupe: 'beige',
  camel: 'brown',
  chocolate: 'brown',
  burgundy: 'red',
  blush: 'pink',
  fuchsia: 'pink',
  'icy-blue': 'blue',
  'sky-blue': 'blue',
  denim: 'blue',
  cobalt: 'blue',
  turquoise: 'green',
  teal: 'green',
  mint: 'green',
  sage: 'green',
  khaki: 'green',
  olive: 'green',
  emerald: 'green',
  'forest-green': 'green',
};

/** The app's filter colour for a reference colour id (`other` for families the filter has no chip for). */
export function toItemColor(colorId: string | null | undefined): ItemColor {
  if (!colorId) return 'other';
  if ((ITEM_COLORS as readonly string[]).includes(colorId)) return colorId as ItemColor;
  return COLOR_FAMILY[colorId] ?? 'other';
}

/** Reference colour id the app sends for one of its own colour keys. */
const COLOR_ID: Record<ItemColor, string | null> = {
  black: 'black',
  white: 'white',
  beige: 'beige',
  navy: 'navy',
  brown: 'brown',
  grey: 'grey',
  cream: 'cream',
  blue: 'cobalt',
  green: 'emerald',
  red: 'red',
  pink: 'pink',
  other: null,
};

/**
 * `colorIds` to send for an app colour. When the user did not change the colour, the server's own
 * ids are kept (so `burgundy` does not become `red` on an unrelated edit). `other` has no reference
 * id: the previous ids are kept, or the list is empty and the server answers `color_required`.
 */
export function toColorIds(color: ItemColor, previous?: string[] | null): string[] {
  if (previous && previous.length > 0 && toItemColor(previous[0]) === color) return previous;
  const id = COLOR_ID[color];
  return id ? [id] : (previous ?? []);
}

export function toItem(wire: ItemWire): Item {
  return {
    id: wire.id,
    name: wire.name,
    category: wire.category,
    subcategory: null,
    brand: wire.brand,
    size: wire.size,
    color: toItemColor(wire.colorIds[0]),
    colorIds: wire.colorIds,
    fabric: toFabricLabel(wire.fabric),
    seasons: wire.seasons,
    imageUrl: wire.imageUrl,
    // The wire has one image URL (cleaned or original, by `useOriginalImage`); there is no second URL.
    originalImageUrl: wire.hasOriginalImage && wire.useOriginalImage ? wire.imageUrl : null,
    hasOriginalImage: wire.hasOriginalImage,
    useOriginalImage: wire.useOriginalImage,
    wearCount: wire.wearCount,
    lastWornAt: wire.lastWornAt,
    createdAt: wire.createdAt,
    baseVersion: wire.version,
  };
}

/** Same key as `wardrobeKeys.items` (features/wardrobe/queries) — the cached, mapped `Item[]`. */
export const ITEMS_QUERY_KEY = ['tenant', 'item'] as const;

export async function requestItems(): Promise<Item[]> {
  return (await apiRequest<ItemWire[]>('v1/tenant/item')).map(toItem);
}

/** The user's wardrobe from the query cache (fetched when missing or older than a minute). */
export function fetchItems(): Promise<Item[]> {
  const client = getActiveQueryClient();
  if (!client) return requestItems();
  return client.fetchQuery({ queryKey: ITEMS_QUERY_KEY, queryFn: requestItems, staleTime: 60_000 });
}

export async function fetchItemMap(): Promise<Map<string, Item>> {
  return new Map((await fetchItems()).map((i) => [i.id, i]));
}

// ---------- looks ----------

export type OutfitSlotWire = 'top' | 'bottom' | 'outerwear' | 'shoes' | 'bagAccessory';
export type LookSourceWire = 'user' | 'stylist' | 'edit' | 'builder';
/** Wire occasions; the app's `Occasion` has one more key (`evening`) that is sent as `dinner`. */
export type OccasionWire = 'office' | 'dinner' | 'weekend' | 'wedding' | 'travel' | 'sport';

export type LookSlotWire = {
  slot: OutfitSlotWire;
  itemId: string | null;
  productId: string | null;
  /** A catalogue product the user does not own ("Eksik parça"). */
  missing?: boolean;
  /** The wardrobe item was deleted. */
  unavailable?: boolean;
};

export type LookWire = {
  id: string;
  name: string;
  occasion: OccasionWire | null;
  slots: LookSlotWire[];
  pieceCount: number;
  hasMissingPieces: boolean;
  favorite: boolean;
  source: LookSourceWire;
  createdAt: string;
  updatedAt: string;
  version: number;
  /** Friends' ratings; null while nobody rated, and wherever the look is embedded in another response. */
  rating: { average: number | null; count: number } | null;
};

export type LookSlotInputWire = { slot: OutfitSlotWire; itemId?: string; productId?: string };

export function toSlotKind(slot: OutfitSlotWire): LookSlotKind {
  return slot === 'bagAccessory' ? 'accessory' : slot;
}

export function fromSlotKind(slot: LookSlotKind): OutfitSlotWire {
  return slot === 'accessory' ? 'bagAccessory' : slot;
}

export function toOccasion(occasion: string | null | undefined): Occasion | null {
  return occasion ? (occasion as Occasion) : null;
}

/** App occasion → wire (`evening` has no wire value; it is the dinner occasion). */
export function fromOccasion(occasion: Occasion | null | undefined): OccasionWire | null {
  if (!occasion) return null;
  return occasion === 'evening' ? 'dinner' : occasion;
}

export function fromSlotInput(slot: LookSlotInput): LookSlotInputWire {
  return slot.source === 'store'
    ? { slot: fromSlotKind(slot.slot), productId: slot.refId }
    : { slot: fromSlotKind(slot.slot), itemId: slot.refId };
}

/** What a slot needs besides its ids. */
export type LookContext = { items: Map<string, Item>; products: Map<string, ProductWire> };

export function toLookSlot(wire: LookSlotWire, ctx: LookContext): LookSlot {
  const slot = toSlotKind(wire.slot);
  if (wire.productId && !wire.itemId) {
    const product = ctx.products.get(wire.productId);
    return {
      slot,
      source: 'store',
      refId: wire.productId,
      name: product?.name ?? '',
      imageUrl: product?.images[0] ?? null,
      brand: product?.brandName ?? null,
      price: product ? toMoney(product.priceMinor, product.currency) : null,
      deleted: false,
    };
  }
  const item = wire.itemId ? ctx.items.get(wire.itemId) : undefined;
  return {
    slot,
    source: 'wardrobe',
    refId: wire.itemId ?? '',
    name: item?.name ?? '',
    imageUrl: item?.imageUrl ?? null,
    brand: item?.brand ?? null,
    price: null,
    deleted: Boolean(wire.unavailable) || !item,
  };
}

export function toLook(wire: LookWire, ctx: LookContext): Look {
  return {
    id: wire.id,
    name: wire.name,
    // A look saved without an occasion (outfit builder) reads as the everyday one.
    occasion: toOccasion(wire.occasion) ?? 'weekend',
    slots: wire.slots.map((s) => toLookSlot(s, ctx)),
    isFavorite: wire.favorite,
    rating: wire.rating && wire.rating.count > 0 ? wire.rating.average : null,
    ratingCount: wire.rating?.count ?? 0,
    // The cover falls back to the piece collage; an existing try-on is read on demand (`GET v1/tenant/tryon`).
    tryOnImageUrl: null,
    createdAt: wire.createdAt,
    baseVersion: wire.version,
  };
}

/** Loads what `toLook` needs for these looks: the wardrobe (cache) and every referenced product. */
export async function loadLookContext(looks: (Pick<LookWire, 'slots'> | null | undefined)[]): Promise<LookContext> {
  const productIds = looks.flatMap((l) => (l ? l.slots.map((s) => (s.itemId ? null : s.productId)) : []));
  const [items, products] = await Promise.all([fetchItemMap(), fetchProductWires(productIds)]);
  return { items, products };
}

export async function toLooks(wires: LookWire[]): Promise<Look[]> {
  const ctx = await loadLookContext(wires);
  return wires.map((w) => toLook(w, ctx));
}

export async function toLookAsync(wire: LookWire): Promise<Look> {
  return toLook(wire, await loadLookContext([wire]));
}

// ---------- fabrics ----------

/**
 * Fabric ids of `GET v1/tenant/reference/wardrobe` with their names. The item form has a free-text
 * fabric field: the text is matched to an id on the way out (an unknown fabric is not sent — the
 * server only accepts reference ids) and the id is shown by name on the way in.
 */
const FABRICS: Record<string, { tr: string; en: string }> = {
  cotton: { tr: 'Pamuk', en: 'Cotton' },
  linen: { tr: 'Keten', en: 'Linen' },
  wool: { tr: 'Yün', en: 'Wool' },
  cashmere: { tr: 'Kaşmir', en: 'Cashmere' },
  silk: { tr: 'İpek', en: 'Silk' },
  satin: { tr: 'Saten', en: 'Satin' },
  chiffon: { tr: 'Şifon', en: 'Chiffon' },
  viscose: { tr: 'Viskon', en: 'Viscose' },
  polyester: { tr: 'Polyester', en: 'Polyester' },
  denim: { tr: 'Denim', en: 'Denim' },
  leather: { tr: 'Deri', en: 'Leather' },
  suede: { tr: 'Süet', en: 'Suede' },
  knit: { tr: 'Triko', en: 'Knit' },
  velvet: { tr: 'Kadife', en: 'Velvet' },
  tweed: { tr: 'Tüvit', en: 'Tweed' },
  nylon: { tr: 'Naylon', en: 'Nylon' },
  fleece: { tr: 'Polar', en: 'Fleece' },
  down: { tr: 'Kaz tüyü', en: 'Down' },
};

const foldText = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Fabric id → name in the app language (an id the table does not know is shown as sent). */
export function toFabricLabel(fabricId: string | null | undefined): string | null {
  if (!fabricId) return null;
  const names = FABRICS[fabricId];
  if (!names) return fabricId;
  return i18n.language?.startsWith('en') ? names.en : names.tr;
}

/** What the user typed (or a label / id) → fabric id; null when it is not a reference fabric. */
export function toFabricId(text: string | null | undefined): string | null {
  if (!text) return null;
  const needle = foldText(text);
  if (!needle) return null;
  for (const [id, names] of Object.entries(FABRICS)) {
    if (id === needle || foldText(names.tr) === needle || foldText(names.en) === needle) return id;
  }
  return null;
}

// ---------- item writes ----------

/** PUT v1/tenant/item/{id} — every user field is replaced. 409 → the current `ItemWire`. */
export type PutItemWire = {
  name: string;
  category: ItemCategory;
  colorIds: string[];
  fabric: string | null;
  seasons: ItemSeason[];
  size: string | null;
  brand: string | null;
  useOriginalImage: boolean;
  baseVersion: number;
};

type ItemFieldsLike = Pick<Item, 'name' | 'category' | 'brand' | 'size' | 'color' | 'colorIds' | 'fabric' | 'seasons' | 'useOriginalImage'>;

/** The user fields of an item as the server takes them (PUT body and confirm rows share them). */
export function fromItemFields(fields: ItemFieldsLike, previousColorIds?: string[] | null): Omit<PutItemWire, 'baseVersion'> {
  return {
    name: fields.name,
    category: fields.category,
    colorIds: toColorIds(fields.color, fields.colorIds ?? previousColorIds),
    fabric: toFabricId(fields.fabric),
    seasons: fields.seasons,
    size: fields.size,
    brand: fields.brand,
    useOriginalImage: fields.useOriginalImage,
  };
}

/** GET v1/tenant/item/{id} */
export type ItemDetailWire = { item: ItemWire; looks: LookWire[] };

export function toItemDetail(wire: ItemDetailWire): ItemDetail {
  return {
    ...toItem(wire.item),
    // Embedded looks carry ids only; the list row needs the name and the occasion.
    looks: wire.looks.map((l) => ({ id: l.id, name: l.name, occasion: l.occasion ?? '', imageUrl: null })),
  };
}

// ---------- uploads and drafts ----------

/** POST v1/tenant/item/upload-url `{ count, contentType }` → one presigned POST per photo. */
export type ItemUploadsWire = { uploads: PresignedPostWire[] };

export type ItemDraftWire = {
  /** = the `uploadId` of the photo. */
  id: string;
  kind: 'single' | 'outfit' | 'piece';
  status: 'uploaded' | 'processing' | 'ready' | 'failed';
  jobId: string | null;
  parentDraftId: string | null;
  /** Cleaned image, or the original while processing / failed. */
  imageUrl: string | null;
  originalImageUrl: string | null;
  imageUrlExpiresAt: string | null;
  name: string | null;
  category: ItemCategory | null;
  colorIds: string[] | null;
  fabric: string | null;
  seasons: ItemSeason[] | null;
  /** ⊆ `category`, `colorIds`, `fabric`, `seasons`. */
  flaggedFields: string[] | null;
  /** "Kategoriyi kontrol et": the box starts unticked and "select all" skips it. */
  needsReview: boolean;
  language: string | null;
  createdAt: string;
};

/** GET v1/tenant/item-draft */
export type ItemDraftsWire = { drafts: ItemDraftWire[]; total: number; processed: number };

/** POST v1/tenant/item-draft */
export type CreateItemDraftsWire = { requestId: string; uploadIds: string[]; splitOutfit: boolean; manual: boolean };
/** 202 of POST v1/tenant/item-draft (and of `…/{id}/retry`). */
export type CreateItemDraftsResultWire = {
  drafts: ItemDraftWire[];
  jobs: JobWire[];
  skippedCount: number;
  skippedUploadIds: string[] | null;
  itemRecognition: { limit: number | null; used: number; remaining: number | null } | null;
};

const FLAGGED: Record<string, DraftField> = { category: 'category', colorIds: 'color', fabric: 'fabric', seasons: 'seasons', name: 'name' };

export function toItemDraft(wire: ItemDraftWire): ItemDraft {
  const ready = wire.status === 'ready';
  const lowConfidence = [...new Set((wire.flaggedFields ?? []).map((f) => FLAGGED[f]).filter((f): f is DraftField => Boolean(f)))];
  if (wire.needsReview && !lowConfidence.includes('category')) lowConfidence.unshift('category');
  const suggestion: ItemDraft['suggestion'] = ready
    ? {
        ...(wire.name ? { name: wire.name } : {}),
        ...(wire.category ? { category: wire.category } : {}),
        ...(wire.colorIds && wire.colorIds.length > 0 ? { color: toItemColor(wire.colorIds[0]), colorIds: wire.colorIds } : {}),
        ...(wire.fabric ? { fabric: toFabricLabel(wire.fabric) } : {}),
        ...(wire.seasons && wire.seasons.length > 0 ? { seasons: wire.seasons } : {}),
      }
    : null;
  return {
    id: wire.id,
    status: ready ? 'ready' : wire.status === 'failed' ? 'failed' : 'processing',
    requestId: wire.jobId ?? wire.parentDraftId ?? '',
    imageUrl: wire.imageUrl ?? wire.originalImageUrl,
    originalImageUrl: wire.originalImageUrl,
    suggestion,
    lowConfidence: ready ? lowConfidence : [],
  };
}

/** The outfit photo of a split is only the source of its `piece` drafts — once split it is never confirmed itself. */
export function toItemDrafts(wire: ItemDraftsWire): ItemDraft[] {
  return wire.drafts.filter((d) => !(d.kind === 'outfit' && d.status === 'ready')).map(toItemDraft);
}

/** One row of POST v1/tenant/item-draft/confirm. The new item id is `itemId ?? clientMutationId`. */
export type ConfirmDraftRowWire = Omit<PutItemWire, 'baseVersion'> & {
  draftId: string;
  clientMutationId: string;
  reviewed: boolean;
  itemId: string | null;
};

export type ItemCreateResultWire = {
  /** draftId / libraryItemId / productId of the request row. */
  refId: string;
  outcome: 'created' | 'alreadyApplied' | 'rejected';
  /** When rejected: `draft_not_found`, `draft_not_ready`, `draft_review_required`, `validation_failed`, `item_id_taken`, `library_item_not_found`, … */
  code: string | null;
  errors: unknown;
  item: ItemWire | null;
};
export type ItemCreateResultsWire = { results: ItemCreateResultWire[]; createdCount: number };

/** POST v1/tenant/item/from-library row. The new item id is `itemId ?? clientMutationId`. */
export type FromLibraryRowWire = { clientMutationId: string; libraryItemId: string; size?: string | null; itemId?: string | null };

// ---------- look writes ----------

/** POST v1/tenant/look → 201 (200 when the same id is sent again). 422 slot rule codes, 400 validation. */
export type CreateLookWire = {
  id: string;
  name: string;
  occasion: OccasionWire | null;
  slots: LookSlotInputWire[];
  favorite: boolean;
  source: LookSourceWire;
};

/** PUT v1/tenant/look/{id} → 409 with the current `LookWire`. */
export type PutLookWire = {
  name: string;
  occasion: OccasionWire | null;
  slots: LookSlotInputWire[];
  favorite: boolean;
  baseVersion: number;
};
