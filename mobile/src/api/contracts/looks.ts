/**
 * E3 Look'lar — the APP-side types. Wire shapes (`LookDto`: slots as `itemId` / `productId`, slot
 * `bagAccessory`, `favorite`, `version`, `rating { average, count }`) and mappers: `../wire/wardrobe.ts`.
 */
import type { Money } from '@/lib/format';
import type { Occasion } from '../contracts';
import type { ContentModeration, ItemCategory } from './wardrobe';

/** The five slots of the look builder (15): Üst · Alt · Dış giyim · Ayakkabı · Çanta / Aksesuar. */
export const LOOK_SLOTS = ['top', 'bottom', 'outerwear', 'shoes', 'accessory'] as const;
export type LookSlotKind = (typeof LOOK_SLOTS)[number];

/** Which wardrobe categories may fill a slot (mirrors the server's OutfitSlotRules; a dress fills "top"). */
export const SLOT_CATEGORIES: Record<LookSlotKind, readonly ItemCategory[]> = {
  top: ['top', 'dress', 'beachwear', 'skiwear'],
  bottom: ['bottom'],
  outerwear: ['outerwear'],
  shoes: ['shoes'],
  accessory: ['bag', 'accessory'],
};

export const LOOK_MIN_PIECES = 2;

export type LookPieceSource = 'wardrobe' | 'store';

export type LookSlot = {
  slot: LookSlotKind;
  /** 'wardrobe' → `refId` is an Item id; 'store' → a catalogue product id (a missing piece). */
  source: LookPieceSource;
  refId: string;
  name: string;
  imageUrl: string | null;
  brand: string | null;
  /** Store pieces only (minor units + ISO currency). */
  price: Money | null;
  /** The wardrobe item was deleted after the look was saved. */
  deleted: boolean;
};

export type Look = {
  /** ULID from the device. */
  id: string;
  name: string;
  occasion: Occasion;
  slots: LookSlot[];
  isFavorite: boolean;
  /** Friends' average (1–5) and how many rated; null when nobody has. */
  rating: number | null;
  ratingCount: number;
  /** Cover: the owner's try-on image when one exists (private, signed URL). */
  tryOnImageUrl: string | null;
  /** Imported look ("Kombinlerini içe aktar"): the outfit photo it came from (private, signed URL). */
  coverImageUrl?: string | null;
  createdAt: string;
  baseVersion: number;
  /** Owner-only: set while a moderator hides the look from everybody else (`LookDto.moderation`). */
  moderation?: ContentModeration | null;
};

/** GET v1/tenant/look → `Look[]` (favourite / occasion filters on the device). GET v1/tenant/look/{id} → `Look`. */
export type LookListResponse = Look[];

export type LookSlotInput = Pick<LookSlot, 'slot' | 'source' | 'refId'>;

/** POST v1/tenant/look → 201 / 200 on replay (idempotent on `id`). 422: `look_min_pieces`, `slot_category_mismatch`, `dress_closes_bottom`, … */
export type CreateLookRequest = {
  id: string;
  name: string;
  occasion: Occasion;
  slots: LookSlotInput[];
  clientMutationId: string;
};

/** PUT v1/tenant/look/{id} — versioned (409 answers the current look). The heart is this PUT with `favorite` changed. */
export type PutLookRequest = {
  name: string;
  occasion: Occasion;
  slots: LookSlotInput[];
  isFavorite: boolean;
  baseVersion: number;
  clientMutationId: string;
};

/** DELETE v1/tenant/look/{id} — no body. */
