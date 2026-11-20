import type { Occasion } from '@/api/contracts';
import {
  LOOK_MIN_PIECES,
  LOOK_SLOTS,
  SLOT_CATEGORIES,
  type Look,
  type LookSlot,
  type LookSlotInput,
  type LookSlotKind,
} from '@/api/contracts/looks';
import type { Item, ItemCategory } from '@/api/contracts/wardrobe';
import { imageVariantsOf } from '@/lib/images';
import type { PlaceholderTone } from '@/theme/tokens';

/** One piece per slot (15: five slots). */
export type SlotMap = Partial<Record<LookSlotKind, LookSlot>>;

export type LookFilter = 'all' | 'favorites' | Occasion;

/** Chips of 14 Looklar, in board order. */
export const LOOK_FILTERS: readonly LookFilter[] = ['all', 'favorites', 'office', 'evening', 'weekend', 'travel'];

/** Occasions offered in the look builder. */
export const LOOK_OCCASIONS: readonly Occasion[] = ['office', 'evening', 'weekend', 'travel', 'dinner', 'wedding', 'sport'];

export function filterLooks(looks: Look[], filter: LookFilter): Look[] {
  if (filter === 'all') return looks;
  if (filter === 'favorites') return looks.filter((l) => l.isFavorite);
  return looks.filter((l) => l.occasion === filter);
}

export function slotForCategory(category: ItemCategory): LookSlotKind | null {
  return LOOK_SLOTS.find((slot) => SLOT_CATEGORIES[slot].includes(category)) ?? null;
}

/** Glyph category for a slot whose wardrobe item is unknown (store piece, deleted piece). */
export const SLOT_FALLBACK_CATEGORY: Record<LookSlotKind, ItemCategory> = {
  top: 'top',
  bottom: 'bottom',
  outerwear: 'outerwear',
  shoes: 'shoes',
  accessory: 'bag',
};

export function slotFromWardrobeItem(slot: LookSlotKind, item: Item): LookSlot {
  return {
    slot,
    source: 'wardrobe',
    refId: item.id,
    name: item.name,
    imageUrl: item.useOriginalImage ? item.originalImageUrl : item.imageUrl,
    ...imageVariantsOf(item),
    brand: item.brand,
    price: null,
    deleted: false,
  };
}

/**
 * Places pieces picked in the 10 multi-select into the builder: each goes to the slot its category
 * fills; the first piece wins a slot, later ones for the same slot (and unknown ids) are skipped.
 */
export function assignItemsToSlots(items: Item[], ids: string[]): { slots: SlotMap; skipped: string[] } {
  const slots: SlotMap = {};
  const skipped: string[] = [];
  for (const id of ids) {
    const item = items.find((i) => i.id === id);
    const slot = item ? slotForCategory(item.category) : null;
    if (!item || !slot || slots[slot]) {
      skipped.push(id);
      continue;
    }
    slots[slot] = slotFromWardrobeItem(slot, item);
  }
  return { slots, skipped };
}

export function parseItemIds(param: string | string[] | undefined): string[] {
  const raw = Array.isArray(param) ? param.join(',') : (param ?? '');
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
}

/**
 * Slots of a saved look as an editable map. A wardrobe piece that no longer exists in the wardrobe
 * (or that the server marked) is flagged `deleted` — it must be replaced or removed before saving.
 */
export function slotMapFromLook(look: Look, items: Item[] | undefined): SlotMap {
  const slots: SlotMap = {};
  for (const s of look.slots) {
    const gone = s.source === 'wardrobe' && items !== undefined && !items.some((i) => i.id === s.refId);
    slots[s.slot] = { ...s, deleted: s.deleted || gone };
  }
  return slots;
}

export function slotList(slots: SlotMap): LookSlot[] {
  return LOOK_SLOTS.flatMap((slot) => (slots[slot] ? [slots[slot]] : []));
}

export function filledCount(slots: SlotMap): number {
  return slotList(slots).length;
}

export function hasDeletedPiece(slots: SlotMap): boolean {
  return slotList(slots).some((s) => s.deleted);
}

/** "Kaydet" opens with at least 2 pieces and no deleted piece left in a slot. */
export function canSaveLook(slots: SlotMap): boolean {
  return filledCount(slots) >= LOOK_MIN_PIECES && !hasDeletedPiece(slots);
}

export function toSlotInputs(slots: SlotMap): LookSlotInput[] {
  return slotList(slots).map(({ slot, source, refId }) => ({ slot, source, refId }));
}

/** Names of the pieces still in the look, in slot order (share text). */
export function lookPieceNames(look: Pick<Look, 'slots'>): string[] {
  return LOOK_SLOTS.flatMap((kind) => look.slots.filter((s) => s.slot === kind && !s.deleted && s.name.trim() !== '').map((s) => s.name));
}

/** Pieces the owner does not have yet (added from the store). */
export function missingPieceCount(look: Pick<Look, 'slots'>): number {
  return look.slots.filter((s) => s.source === 'store' && !s.deleted).length;
}

/** Grounds of the look placeholders, in the order 14 Looklar draws them. */
const COVER_TONES: readonly (PlaceholderTone | 'sand')[] = ['taupe', 'dark', 'clay', 'sand', 'stage', 'camel'];

/** Stable placeholder ground for a look: the same look always gets the same tone. */
export function coverTone(seed: string): PlaceholderTone | 'sand' {
  let sum = 0;
  for (let i = 0; i < seed.length; i += 1) sum = (sum + seed.charCodeAt(i)) % 997;
  return COVER_TONES[sum % COVER_TONES.length] ?? 'stage';
}

export function sameSlots(a: LookSlotInput[], b: LookSlotInput[]): boolean {
  const key = (list: LookSlotInput[]) => list.map((s) => `${s.slot}:${s.source}:${s.refId}`).sort().join('|');
  return key(a) === key(b);
}
