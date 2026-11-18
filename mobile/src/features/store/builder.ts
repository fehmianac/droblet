import {
  BUILDER_SLOTS,
  type BuilderSlot,
  type CreateLookRequest,
  type ProductSize,
  type ProductSummary,
  type WardrobePiece,
} from '@/api/contracts/store';

import { sumMoney, type Money } from '@/lib/format';

import { preferredSize } from './cartMath';
import { slotOfCategory } from './slots';

/** What fills a slot of the outfit builder (23): a store product (with a size) or a wardrobe piece. */
export type SlotFill =
  | { source: 'store'; product: ProductSummary; size: ProductSize }
  | { source: 'wardrobe'; piece: WardrobePiece };

export type BuilderSlots = Record<BuilderSlot, SlotFill | null>;

export const EMPTY_SLOTS: BuilderSlots = { top: null, bottom: null, outerwear: null, shoes: null, bag: null };

/** A look needs at least two pieces before it can be saved (same rule as 15 Look oluştur). */
export const MIN_LOOK_PIECES = 2;

export function storeFill(product: ProductSummary, profileSize: ProductSize | null): SlotFill {
  return { source: 'store', product, size: preferredSize(product.sizes, profileSize) ?? product.sizes[0] ?? '' };
}

/** Places a store product into the slot its category belongs to; unchanged when it fits none. */
export function withProduct(slots: BuilderSlots, product: ProductSummary, profileSize: ProductSize | null): BuilderSlots {
  const slot = slotOfCategory(product.category);
  return slot ? { ...slots, [slot]: storeFill(product, profileSize) } : slots;
}

export function filledCount(slots: BuilderSlots): number {
  return BUILDER_SLOTS.filter((s) => slots[s] !== null).length;
}

export function firstEmptySlot(slots: BuilderSlots): BuilderSlot | null {
  return BUILDER_SLOTS.find((s) => slots[s] === null) ?? null;
}

/** The store products in the outfit, in slot order — what "N ürünü satın al" adds to the cart. */
export function storeItems(slots: BuilderSlots): { product: ProductSummary; size: ProductSize }[] {
  return BUILDER_SLOTS.flatMap((s) => {
    const fill = slots[s];
    return fill?.source === 'store' ? [{ product: fill.product, size: fill.size }] : [];
  });
}

/** Sum of the store products' prices (pieces without a published price are left out); null when none is priced. */
export function storeTotal(slots: BuilderSlots): Money | null {
  return sumMoney(storeItems(slots).map((i) => i.product.price));
}

export function toLookSlots(slots: BuilderSlots): CreateLookRequest['slots'] {
  return BUILDER_SLOTS.flatMap((slot): CreateLookRequest['slots'] => {
    const fill = slots[slot];
    if (!fill) return [];
    return fill.source === 'store'
      ? [{ slot, source: 'store', productId: fill.product.id }]
      : [{ slot, source: 'wardrobe', itemId: fill.piece.id }];
  });
}
