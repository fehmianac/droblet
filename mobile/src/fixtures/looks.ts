import { moneyFromMajor } from '@/lib/format';
import type { CreateLookRequest, Look, LookSlot, LookSlotInput, LookSlotKind, PutLookRequest } from '@/api/contracts/looks';
import { ApiError } from '@/api/errors';

import { clone, fixtureDb } from './db';

/**
 * Fixture "server" for look writes (E3) and a tiny stand-in catalogue for the slot sheet's Mağaza tab.
 * The real catalogue (E8) belongs to the store slice; these few products only let the look builder
 * exercise `source: 'store'` slots.
 */
export type StubProduct = { id: string; slot: LookSlotKind; brand: string; name: string; price: number };

export const stubSlotProducts: StubProduct[] = [
  { id: 'prod_silk_blouse', slot: 'top', brand: 'Atölye Nord', name: 'İpek bluz', price: 4250 },
  { id: 'prod_wide_trousers', slot: 'bottom', brand: 'Maison Lin', name: 'Bol paça pantolon', price: 3890 },
  { id: 'prod_wool_coat', slot: 'outerwear', brand: 'Atölye Nord', name: 'Yün kaban', price: 12900 },
  { id: 'prod_rain_boots', slot: 'shoes', brand: 'Kuzey', name: 'Yağmur botu', price: 3450 },
  { id: 'prod_loafers', slot: 'shoes', brand: 'Maison Lin', name: 'Deri loafer', price: 5600 },
  { id: 'prod_earrings', slot: 'accessory', brand: 'Atölye Nord', name: 'Küçük taşlı küpe', price: 1850 },
];

function resolveSlot(input: LookSlotInput): LookSlot {
  if (input.source === 'wardrobe') {
    const item = fixtureDb.items.find((i) => i.id === input.refId);
    return {
      ...input,
      name: item?.name ?? '',
      imageUrl: item ? (item.useOriginalImage ? item.originalImageUrl : item.imageUrl) : null,
      brand: item?.brand ?? null,
      price: null,
      deleted: !item,
    };
  }
  const product = stubSlotProducts.find((p) => p.id === input.refId);
  return { ...input, name: product?.name ?? '', imageUrl: null, brand: product?.brand ?? null, price: product ? moneyFromMajor(product.price, 'TRY') : null, deleted: false };
}

export function fixtureCreateLook(request: CreateLookRequest): Look {
  const existing = fixtureDb.looks.find((l) => l.id === request.id);
  if (existing) return clone(existing);
  const look: Look = {
    id: request.id,
    name: request.name,
    occasion: request.occasion,
    slots: request.slots.map(resolveSlot),
    isFavorite: false,
    rating: null,
    ratingCount: 0,
    tryOnImageUrl: null,
    createdAt: new Date().toISOString(),
    baseVersion: 1,
  };
  fixtureDb.looks = [look, ...fixtureDb.looks];
  return clone(look);
}

export function fixturePutLook(id: string, request: PutLookRequest): Look {
  const index = fixtureDb.looks.findIndex((l) => l.id === id);
  const current = fixtureDb.looks[index];
  if (!current) throw new ApiError('http', 404, null);
  if (current.baseVersion !== request.baseVersion) throw new ApiError('http', 409, { current: clone(current) });
  const slotsChanged = JSON.stringify(current.slots.map((s) => [s.slot, s.source, s.refId])) !== JSON.stringify(request.slots.map((s) => [s.slot, s.source, s.refId]));
  const saved: Look = {
    ...current,
    name: request.name,
    occasion: request.occasion,
    slots: request.slots.map(resolveSlot),
    isFavorite: request.isFavorite,
    // A try-on image belongs to the pieces it was generated for.
    tryOnImageUrl: slotsChanged ? null : current.tryOnImageUrl,
    baseVersion: current.baseVersion + 1,
  };
  fixtureDb.looks[index] = saved;
  return clone(saved);
}

export function fixtureDeleteLook(id: string): void {
  fixtureDb.looks = fixtureDb.looks.filter((l) => l.id !== id);
}
