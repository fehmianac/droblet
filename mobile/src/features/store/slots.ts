import type { BuilderSlot, ProductCategory } from '@/api/contracts/store';

/** Which catalogue categories can fill each outfit-builder slot (23). */
const SLOT_CATEGORIES: Record<BuilderSlot, ProductCategory[]> = {
  top: ['tshirt', 'shirt', 'knit'],
  bottom: ['trousers'],
  outerwear: ['jacket'],
  shoes: ['shoes'],
  bag: ['bag'],
};

export function slotCategories(slot: BuilderSlot): ProductCategory[] {
  return SLOT_CATEGORIES[slot];
}

export function slotOfCategory(category: ProductCategory): BuilderSlot | null {
  return (Object.keys(SLOT_CATEGORIES) as BuilderSlot[]).find((s) => SLOT_CATEGORIES[s].includes(category)) ?? null;
}
