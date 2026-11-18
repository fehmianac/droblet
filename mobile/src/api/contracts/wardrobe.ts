/**
 * E2 Gardırop — the APP-side types the screens use. The real request / response shapes
 * (docs/api/wardrobe-looks-plan-stylist.md §3) and the mappers live in `../wire/wardrobe.ts`; the
 * hooks in `features/wardrobe` translate at the API boundary.
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
  /** Free-text type inside the category, e.g. "Gömlek". Device-only: the server has no such field (always null from the API). */
  subcategory: string | null;
  brand: string | null;
  size: string | null;
  color: ItemColor;
  /** The server's reference colour ids behind `color` (`[0]` = main). Absent on fixture / optimistic records. */
  colorIds?: string[];
  fabric: string | null;
  /** At least one. */
  seasons: ItemSeason[];
  /** Background-removed image (short-lived signed URL). */
  imageUrl: string | null;
  /** The photo as taken ("Orijinale dön"). */
  originalImageUrl: string | null;
  /** The photo as taken still exists on the server, so "Orijinale dön" can be offered. */
  hasOriginalImage?: boolean;
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

/** GET v1/tenant/item/{id} → `{ item, looks }` on the wire, flattened here. */
export type ItemDetail = Item & { looks: LookRef[] };

export type ItemFields = Pick<Item, 'name' | 'category' | 'subcategory' | 'brand' | 'size' | 'color' | 'colorIds' | 'fabric' | 'seasons' | 'useOriginalImage'>;

/** PUT v1/tenant/item/{id} — versioned; 409 answers the current record. Sent as `PutItemWire` (colorIds, fabric id). */
export type PutItemRequest = ItemFields & { baseVersion: number; clientMutationId: string };

/** DELETE v1/tenant/item/{id} — no body; idempotent (404 = already gone). */

/** POST v1/tenant/item/upload-url (count 1–30) → `{ uploads: PresignedPostWire[] }` (multipart POST: fields, then `file`). */
export type ItemUploadUrlRequest = { count: number; contentType: 'image/jpeg' };

/**
 * What a screen asks for: local photos to turn into drafts. On the API this is upload-url → S3 →
 * `POST v1/tenant/item-draft { requestId, uploadIds, splitOutfit, manual }` → 202 (one draft and one
 * job per photo). `splitOutfit`: "Kombin fotoğrafından parçaları ayır" — one photo may yield several drafts.
 * `photoKeys` are the local URIs (fixtures use them as the draft picture).
 */
export type CreateItemDraftsRequest = { requestId: string; photoKeys: string[]; splitOutfit?: boolean };
/**
 * 402 `item_recognition_limit_reached` when the free allowance is used up, 403 `premium_required` when
 * the limit is 0 (nothing is started; the app turns the uploaded photos into manual drafts).
 * When only part of the batch fits, the server starts those and reports the rest in `skippedCount`
 * (`skippedUploadIds` on the wire — they become manual drafts too).
 */
export type CreateItemDraftsResponse = JobAccepted & { draftIds: string[]; skippedCount?: number };

export type DraftField = 'name' | 'category' | 'color' | 'fabric' | 'seasons';

/** GET v1/tenant/item-draft → `ItemDraft[]` */
export type ItemDraft = {
  id: string;
  status: 'processing' | 'ready' | 'failed';
  /** The draft's job id on the API (empty for a manual draft); the batch id in fixtures. */
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
 * POST v1/tenant/item-draft/{id}/retry → 202, no body: re-runs the ItemProcessor for a failed draft
 * without uploading the photo again (404 `draft_not_found`, 409 `draft_not_failed`, allowance rules as above).
 */

/**
 * "Gardıroba kaydet" as the screens build it. Rows with a `draftId` go to
 * `POST v1/tenant/item-draft/confirm`, rows with a `libraryItemId` to `POST v1/tenant/item/from-library`;
 * both answer per-row outcomes (`created` | `alreadyApplied` | `rejected` + code).
 */
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
/** The items that exist after the call (rejected rows are absent). */
export type ConfirmItemDraftsResponse = { items: Item[] };

/** Bulk add limit (13). */
export const BULK_ADD_MAX = 30;
