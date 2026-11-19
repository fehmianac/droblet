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
  /** Free-text type inside the category, e.g. "Gömlek" (`ItemDto.subcategory`, ≤ 40 chars). */
  subcategory: string | null;
  brand: string | null;
  size: string | null;
  color: ItemColor;
  /** The server's reference colour ids behind `color` (`[0]` = main). Absent on fixture / optimistic records. */
  colorIds?: string[];
  /** `#RRGGBB` of a colour the palette has no chip for (only with `color: 'other'`; `ItemDto.colorHex`). */
  colorHex?: string | null;
  /** Fabric as shown: the reference fabric's name, or the user's own text (`ItemDto.fabricText`). */
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

export type ItemFields = Pick<
  Item,
  'name' | 'category' | 'subcategory' | 'brand' | 'size' | 'color' | 'colorIds' | 'colorHex' | 'fabric' | 'seasons' | 'useOriginalImage'
>;

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

/** Normalised (0–1) box of a piece in its group photo: top-left corner + size. */
export type DraftBox = { x: number; y: number; width: number; height: number };

/**
 * GET v1/tenant/item-draft → `ItemDraft[]`.
 *
 * Multi-item detection: a photo with two or more pieces becomes a **group** (`kind: 'group'`, the photo
 * itself, with `itemCount` and `photoSize`) and each piece a draft with `kind: 'piece'`, the same
 * `groupId`, its `box`, `index` and `confidence`. A piece is `detected` until the user selects it
 * (its picture is the plain crop), then `processing` (background removal) → `ready` | `failed`.
 */
export type ItemDraft = {
  id: string;
  status: 'processing' | 'ready' | 'failed' | 'detected';
  /** `single` (one piece, or a manual entry) when absent. */
  kind?: 'single' | 'group' | 'piece';
  /** The group photo's draft id (for the group itself and for its pieces). */
  groupId?: string | null;
  box?: DraftBox | null;
  /** 1-based number of a piece in its photo (the box outline shows it). */
  index?: number | null;
  /** 0–1: how sure the model is that the box holds one real piece. */
  confidence?: number | null;
  /** The user kept this piece in the chooser. */
  selected?: boolean;
  /** Group only: pieces found, and the photo's pixel size (boxes are drawn on it). */
  itemCount?: number | null;
  photoSize?: { width: number; height: number } | null;
  /** Why a failed draft failed: `guardRejected` = no piece was found in the photo. */
  failure?: string | null;
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
    /** Null for a piece added without AI: library rows go to `item/from-library`, the rest to `POST v1/tenant/item` (no photo). */
    draftId: string | null;
    /** The new Item's id (ULID from the device). */
    id: string;
    /** Library piece this item was created from (12b), when any. */
    libraryItemId?: string | null;
    /**
     * Fixture mode only: the local photo of a piece entered WITHOUT AI. Against the API that photo is
     * uploaded and becomes a manual draft (`POST v1/tenant/item-draft { manual: true }`), and the entry is
     * confirmed through its `draftId` instead (see `withManualPhotos`); this field is never sent.
     */
    photoKey?: string | null;
    reviewed: boolean;
    clientMutationId: string;
  })[];
};
/** The items that exist after the call (rejected rows are absent). */
export type ConfirmItemDraftsResponse = { items: Item[] };

/** Bulk add limit (13). */
export const BULK_ADD_MAX = 30;
