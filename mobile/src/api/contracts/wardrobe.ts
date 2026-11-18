/**
 * E2 Gardırop — PROVISIONAL contract (BACKEND_ENGINEER §Uç nokta haritası, E2). Backend is being
 * written in parallel; adjust here when it settles. JSON camelCase, UTC ISO-8601 times.
 */
import type { JobAccepted } from './jobs';

export const ITEM_CATEGORIES = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'bag', 'accessory', 'beachwear', 'skiwear'] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const ITEM_SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type ItemSeason = (typeof ITEM_SEASONS)[number];

/** Colour families used for filtering (10 filter sheet) and palette matching. */
export const ITEM_COLORS = ['black', 'white', 'beige', 'navy', 'brown', 'grey', 'cream', 'blue', 'green', 'red', 'pink', 'other'] as const;
export type ItemColor = (typeof ITEM_COLORS)[number];

/** A confirmed wardrobe piece. */
export type Item = {
  /** ULID, generated on the device when the draft is confirmed. */
  id: string;
  name: string;
  category: ItemCategory;
  /** Free-text type inside the category, e.g. "Gömlek". */
  subcategory: string | null;
  brand: string | null;
  size: string | null;
  color: ItemColor;
  fabric: string | null;
  /** At least one. */
  seasons: ItemSeason[];
  /** Background-removed image (short-lived signed URL). */
  imageUrl: string | null;
  /** The photo as taken ("Orijinale dön"). */
  originalImageUrl: string | null;
  useOriginalImage: boolean;
  wearCount: number;
  lastWornAt: string | null;
  createdAt: string;
  baseVersion: number;
};

/** GET v1/tenant/item → `Item[]` (filter / sort / search happen on the device). */
export type ItemListResponse = Item[];

/** A look as referenced from another record (item detail, plan day, trip day). */
export type LookRef = { id: string; name: string; occasion: string; imageUrl: string | null };

/** GET v1/tenant/item/{id} */
export type ItemDetail = Item & { looks: LookRef[] };

export type ItemFields = Pick<Item, 'name' | 'category' | 'subcategory' | 'brand' | 'size' | 'color' | 'fabric' | 'seasons' | 'useOriginalImage'>;

/** PUT v1/tenant/item/{id} — versioned (409 + `current` on conflict). */
export type PutItemRequest = ItemFields & { baseVersion: number; clientMutationId: string };

/** DELETE v1/tenant/item/{id} — no body; idempotent (404 = already gone). */

/** POST v1/tenant/item/upload-url */
export type ItemUploadUrlRequest = { count: number; contentType: 'image/jpeg' };
export type ItemUploadUrlResponse = { uploads: { photoKey: string; uploadUrl: string; expiresAt: string }[] };

/**
 * POST v1/tenant/item-draft → 202. One ItemProcessor job per photo.
 * `splitOutfit`: "Kombin fotoğrafından parçaları ayır" — one photo may yield several drafts.
 */
export type CreateItemDraftsRequest = { requestId: string; photoKeys: string[]; splitOutfit?: boolean };
export type CreateItemDraftsResponse = JobAccepted & { draftIds: string[] };

export type DraftField = 'name' | 'category' | 'color' | 'fabric' | 'seasons';

/** GET v1/tenant/item-draft → `ItemDraft[]` */
export type ItemDraft = {
  id: string;
  status: 'processing' | 'ready' | 'failed';
  /** Batch the draft belongs to (bulk add progress "8 / 12"). */
  requestId: string;
  /** Local preview until the processed image exists. */
  imageUrl: string | null;
  originalImageUrl: string | null;
  /** AI suggestion — never saved without the user's confirmation. */
  suggestion: Partial<ItemFields> | null;
  /** Fields the model was unsure about ("Kategoriyi kontrol et"). */
  lowConfidence: DraftField[];
};

/** DELETE v1/tenant/item-draft/{id} — no body; discards the draft and its photo. */

/**
 * POST v1/tenant/item-draft/{id}/retry → 202, no body. ASSUMED (not in the endpoint map): re-runs the
 * ItemProcessor for a failed draft without uploading the photo again.
 */

/** POST v1/tenant/item-draft/confirm */
export type ConfirmItemDraftsRequest = {
  items: (ItemFields & {
    /** Null for a piece added without AI (ready-made library / manual). */
    draftId: string | null;
    /** The new Item's id (ULID from the device). */
    id: string;
    /** Library piece this item was created from (12b), when any. */
    libraryItemId?: string | null;
    reviewed: boolean;
    clientMutationId: string;
  })[];
};
export type ConfirmItemDraftsResponse = { items: Item[] };

/** Bulk add limit (13). */
export const BULK_ADD_MAX = 30;
