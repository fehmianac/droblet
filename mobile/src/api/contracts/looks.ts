/**
 * E3 Look'lar — PROVISIONAL contract (BACKEND_ENGINEER §Uç nokta haritası, E3).
 */
import type { Occasion } from '../contracts';
import type { ItemCategory } from './wardrobe';

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
  /** TRY, store pieces only. */
  price: number | null;
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
  createdAt: string;
  baseVersion: number;
};

/** GET v1/tenant/look → `Look[]` (favourite / occasion filters on the device). GET v1/tenant/look/{id} → `Look`. */
export type LookListResponse = Look[];

export type LookSlotInput = Pick<LookSlot, 'slot' | 'source' | 'refId'>;

/** POST v1/tenant/look — idempotent on `id` + `clientMutationId`. */
export type CreateLookRequest = {
  id: string;
  name: string;
  occasion: Occasion;
  slots: LookSlotInput[];
  clientMutationId: string;
};

/** PUT v1/tenant/look/{id} — versioned (409 on conflict). */
export type PutLookRequest = {
  name: string;
  occasion: Occasion;
  slots: LookSlotInput[];
  isFavorite: boolean;
  baseVersion: number;
  clientMutationId: string;
};

/** DELETE v1/tenant/look/{id} — no body. */
