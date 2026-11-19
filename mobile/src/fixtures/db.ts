import type { Entitlement } from '@/api/contracts';
import type { Look, LookSlot, LookSlotKind } from '@/api/contracts/looks';
import type { PlanDay, WearLog } from '@/api/contracts/today';
import type { Item, ItemCategory, ItemColor, ItemSeason } from '@/api/contracts/wardrobe';

import { L, SHOWCASE } from './showcase';

/**
 * In-memory stand-in for the tenant's server data while the E2–E6 backend is written. Shared by the
 * wardrobe, looks, today, trips and stylist fixtures so the screens stay consistent with each other
 * (a look saved in 15 shows up in 14, a deleted piece disappears from the slot picker, …).
 * Feature fixtures add their own collections in their own files and read items / looks from here.
 * Sample names come from the design boards. Nothing survives an app restart.
 */

const CREATED = '2026-11-02T09:00:00.000Z';

function item(
  id: string,
  name: string,
  category: ItemCategory,
  color: ItemColor,
  seasons: ItemSeason[],
  extra: Partial<Item> = {},
): Item {
  return {
    id,
    name: L(name),
    category,
    subcategory: null,
    brand: null,
    size: 'S',
    color,
    fabric: null,
    seasons,
    imageUrl: null,
    originalImageUrl: null,
    useOriginalImage: false,
    wearCount: 0,
    lastWornAt: null,
    createdAt: CREATED,
    baseVersion: 1,
    ...extra,
    ...(extra.subcategory ? { subcategory: L(extra.subcategory) } : {}),
    ...(extra.fabric ? { fabric: L(extra.fabric) } : {}),
  };
}

function seedItems(): Item[] {
  return [
    item('item_white_shirt', 'Beyaz poplin gömlek', 'top', 'white', ['spring', 'autumn'], { subcategory: 'Gömlek', fabric: 'Pamuk', brand: 'Marks & Spencer', wearCount: 9 }),
    item('item_navy_blazer', 'Lacivert yün blazer', 'outerwear', 'navy', ['autumn', 'winter'], { subcategory: 'Blazer', fabric: 'Yün', brand: 'Vakko', wearCount: 6 }),
    item('item_black_midi', 'Siyah midi elbise', 'dress', 'black', ['spring', 'autumn', 'winter'], { fabric: 'Viskon', wearCount: 4 }),
    item('item_straight_jeans', 'Düz jean', 'bottom', 'blue', ['spring', 'summer', 'autumn', 'winter'], { subcategory: 'Jean', fabric: 'Denim', brand: 'Gap', wearCount: 12 }),
    item('item_cream_knit', 'Krem triko', 'top', 'cream', ['autumn', 'winter'], { subcategory: 'Triko', fabric: 'Yün', wearCount: 7 }),
    item('item_croc_flats', 'Kroko babet', 'shoes', 'beige', ['spring', 'summer', 'autumn'], { size: '38', fabric: 'Deri', wearCount: 5 }),
    item('item_black_bag', 'Siyah deri çanta', 'bag', 'black', ['spring', 'summer', 'autumn', 'winter'], { size: null, fabric: 'Deri', brand: 'Vakko', wearCount: 14 }),
    item('item_tweed_jacket', 'Tüvit ceket', 'outerwear', 'beige', ['spring', 'autumn'], { subcategory: 'Ceket', fabric: 'Tüvit', wearCount: 3 }),
    item('item_beige_trench', 'Bej trençkot', 'outerwear', 'beige', ['spring', 'autumn'], { subcategory: 'Trençkot', fabric: 'Pamuk', wearCount: 2 }),
    item('item_black_trousers', 'Siyah kumaş pantolon', 'bottom', 'black', ['spring', 'autumn', 'winter'], { subcategory: 'Pantolon', fabric: 'Yün karışım', wearCount: 8 }),
    item('item_black_boots', 'Siyah bot', 'shoes', 'black', ['autumn', 'winter'], { size: '38', fabric: 'Deri', wearCount: 6 }),
    item('item_white_sneakers', 'Beyaz sneaker', 'shoes', 'white', ['spring', 'summer', 'autumn'], { size: '38', wearCount: 10 }),
    item('item_silk_scarf', 'İpek fular', 'accessory', 'brown', ['spring', 'autumn'], { size: null, fabric: 'İpek', wearCount: 1 }),
    item('item_linen_shirt', 'Keten gömlek', 'top', 'beige', ['spring', 'summer'], { subcategory: 'Gömlek', fabric: 'Keten', wearCount: 0 }),
  ];
}

export function slotFromItem(slot: LookSlotKind, source: Item): LookSlot {
  return {
    slot,
    source: 'wardrobe',
    refId: source.id,
    name: source.name,
    imageUrl: source.useOriginalImage ? source.originalImageUrl : source.imageUrl,
    brand: source.brand,
    price: null,
    deleted: false,
  };
}

function seedLooks(items: Item[]): Look[] {
  const byId = (id: string): Item => {
    const found = items.find((i) => i.id === id);
    if (!found) throw new Error(`fixture item missing: ${id}`);
    return found;
  };
  const look = (id: string, name: string, occasion: Look['occasion'], slots: [LookSlotKind, string][], extra: Partial<Look> = {}): Look => ({
    id,
    name: L(name),
    occasion,
    slots: slots.map(([slot, itemId]) => slotFromItem(slot, byId(itemId))),
    isFavorite: false,
    rating: null,
    ratingCount: 0,
    tryOnImageUrl: null,
    createdAt: CREATED,
    baseVersion: 1,
    ...extra,
  });
  return [
    look(
      'look_lacivert_blazer',
      'Lacivert Blazer',
      'office',
      [
        ['top', 'item_white_shirt'],
        ['bottom', 'item_black_trousers'],
        ['outerwear', 'item_navy_blazer'],
      ],
      { isFavorite: true, rating: 4.6, ratingCount: 12 },
    ),
    look(
      'look_siyah_duz_elbise',
      'Siyah Düz Elbise',
      'evening',
      [
        ['top', 'item_black_midi'],
        ['shoes', 'item_croc_flats'],
        ['accessory', 'item_black_bag'],
      ],
      { rating: 4.8, ratingCount: 9 },
    ),
    look('look_tuvit_jean', 'Tüvit & Jean', 'weekend', [
      ['top', 'item_cream_knit'],
      ['bottom', 'item_straight_jeans'],
      ['outerwear', 'item_tweed_jacket'],
      ['shoes', 'item_white_sneakers'],
    ]),
    look(
      'look_krem_katmanlar',
      'Krem Katmanlar',
      'office',
      [
        ['top', 'item_cream_knit'],
        ['bottom', 'item_black_trousers'],
        ['outerwear', 'item_beige_trench'],
        ['shoes', 'item_black_boots'],
      ],
      { rating: 4.2, ratingCount: 5 },
    ),
  ];
}

type FixtureDb = {
  items: Item[];
  looks: Look[];
  /** Seeded relative to today by the Bugün fixtures (`onFixtureSeed`). */
  planDays: PlanDay[];
  wearLogs: WearLog[];
  entitlement: Entitlement;
};

type Seeder = (db: FixtureDb, options: { empty: boolean }) => void;
const seeders: Seeder[] = [];

/**
 * Lets a feature's fixture file seed its own collections (and re-seed them on `resetFixtureDb`)
 * without editing this file. Runs immediately and again on every reset.
 */
export function onFixtureSeed(seeder: Seeder): void {
  seeders.push(seeder);
  seeder(fixtureDb, { empty: false });
}

function seed(): FixtureDb {
  const items = seedItems();
  return {
    items,
    looks: seedLooks(items),
    planDays: [],
    wearLogs: [],
    entitlement: {
      tier: 'member',
      // The showcase build matches the mock entitlement of the screenshot capture (Profil: 24 of 30 left).
      credits: { monthlyAllowance: 30, remaining: SHOWCASE ? 24 : 11, resetsAt: '2026-12-01T00:00:00.000Z' },
      // Member: unlimited AI recognition. `setFixtureItemRecognition` (fixtures/wardrobe) switches to a free quota.
      itemRecognition: { limit: null, used: 0, remaining: null },
      // The plan's photos per outfit import (the server value; 30 for both plans today).
      outfitImportMaxPhotos: 30,
    },
  };
}

/** Mutable on purpose: fixture mutation functions edit it like a server would. Always return copies to callers. */
export const fixtureDb: FixtureDb = seed();

/** Restores the seed (tests) or empties the wardrobe (to exercise empty states). */
export function resetFixtureDb(options: { empty?: boolean } = {}): void {
  const fresh = seed();
  fixtureDb.items = options.empty ? [] : fresh.items;
  fixtureDb.looks = options.empty ? [] : fresh.looks;
  fixtureDb.planDays = [];
  fixtureDb.wearLogs = [];
  fixtureDb.entitlement = fresh.entitlement;
  seeders.forEach((seeder) => seeder(fixtureDb, { empty: Boolean(options.empty) }));
}

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** 404-like error for fixture lookups; `isNotFound` reads it as a 404, so `ScreenState` shows the not-found state. */
export class FixtureNotFound extends Error {
  constructor(what: string) {
    super(`fixture not found: ${what}`);
    this.name = 'FixtureNotFound';
  }
}
