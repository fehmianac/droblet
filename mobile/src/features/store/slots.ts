import { BUILDER_SLOTS, type BuilderSlot, type ProductCategory } from '@/api/contracts/store';
import type { LookSlotKind } from '@/api/contracts/looks';
import type { ItemCategory } from '@/api/contracts/wardrobe';

/** Which catalogue categories can fill each outfit-builder slot (23). */
const SLOT_CATEGORIES: Record<BuilderSlot, ProductCategory[]> = {
  top: ['tshirt', 'shirt', 'blouse', 'knit', 'sweatshirt', 'activewear'],
  bottom: ['trousers', 'jeans', 'skirt', 'shorts'],
  outerwear: ['jacket', 'coat', 'skiwear'],
  shoes: ['shoes'],
  bag: ['bag'],
};

export function slotCategories(slot: BuilderSlot): ProductCategory[] {
  return SLOT_CATEGORIES[slot];
}

export function slotOfCategory(category: ProductCategory): BuilderSlot | null {
  return (Object.keys(SLOT_CATEGORIES) as BuilderSlot[]).find((s) => SLOT_CATEGORIES[s].includes(category)) ?? null;
}

/** The builder slot a wardrobe piece fits (its Gardırop category), or null (dress, accessory, …). */
export function slotOfItemCategory(category: ItemCategory): BuilderSlot | null {
  return (BUILDER_SLOTS as readonly string[]).includes(category) ? (category as BuilderSlot) : null;
}

/** Which catalogue categories can fill each slot of a look (15 "Mağaza" tab; a dress fills "top"). */
const LOOK_SLOT_CATEGORIES: Record<LookSlotKind, ProductCategory[]> = {
  top: ['tshirt', 'shirt', 'blouse', 'knit', 'sweatshirt', 'activewear', 'dress', 'swimwear'],
  bottom: ['trousers', 'jeans', 'skirt', 'shorts'],
  outerwear: ['jacket', 'coat', 'skiwear'],
  shoes: ['shoes'],
  socks: [],
  bag: ['bag'],
  accessory: ['accessory'],
};

export function lookSlotCategories(slot: LookSlotKind): ProductCategory[] {
  return LOOK_SLOT_CATEGORIES[slot];
}
