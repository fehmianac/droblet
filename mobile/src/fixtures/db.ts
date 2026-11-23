import type { Entitlement } from '@/api/contracts';
import type { Look, LookSlot, LookSlotKind } from '@/api/contracts/looks';
import type { PlanDay, WearLog } from '@/api/contracts/today';
import type { Item, ItemCategory, ItemColor, ItemSeason } from '@/api/contracts/wardrobe';

import { L, SHOWCASE } from './showcase';
import { showcaseImage, type ShowcaseImage } from './showcaseImages';

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
    ...(SHOWCASE ? showcaseItems() : []),
  ].map((i, index) => {
    const imageUrl = showcaseImage(ITEM_IMAGES[i.id]);
    // Showcase build: the pieces with a picture count as the newest, so Gardırop (newest first) opens on them.
    return imageUrl ? { ...i, imageUrl, createdAt: `2026-11-1${Math.floor(index / 10)}T1${index % 10}:00:00.000Z` } : i;
  });
}

/**
 * More pieces for the showcase build only (photographs in `assets/showcase/item-*`): Gardırop opens on a screen of
 * pictures. Jest keeps the 14 pieces above — the seed its tests count and name.
 */
function showcaseItems(): Item[] {
  return [
    item('item_black_turtleneck', 'Siyah balıkçı yaka', 'top', 'black', ['autumn', 'winter'], { wearCount: 11 }),
    item('item_beige_trousers', 'Bej bol pantolon', 'bottom', 'beige', ['spring', 'autumn'], { subcategory: 'Pantolon', fabric: 'Pamuk', wearCount: 5 }),
    item('item_suede_bag', 'Taba süet çanta', 'bag', 'brown', ['autumn', 'winter'], { size: null, wearCount: 7 }),
    item('item_black_belt', 'Siyah deri kemer', 'accessory', 'black', ['spring', 'summer', 'autumn', 'winter'], { subcategory: 'Kemer', size: null, fabric: 'Deri', wearCount: 13 }),
    item('item_blue_knit', 'Mavi triko', 'top', 'blue', ['autumn', 'winter'], { subcategory: 'Triko', wearCount: 3 }),
    item('item_ecru_tee', 'Ekru tişört', 'top', 'cream', ['spring', 'summer'], { fabric: 'Pamuk', wearCount: 15 }),
    item('item_black_skirt', 'Siyah etek', 'bottom', 'black', ['spring', 'autumn', 'winter'], { wearCount: 4 }),
    item('item_camel_coat', 'Taba kaban', 'outerwear', 'brown', ['autumn', 'winter'], { subcategory: 'Kaban', wearCount: 6 }),
    item('item_check_shirt', 'Ekose gömlek', 'top', 'white', ['spring', 'summer', 'autumn'], { subcategory: 'Gömlek', wearCount: 2 }),
  ];
}

/**
 * The men's showcase account (canvas 17, "Emre"): the same ids as the women's seed, so every fixture that
 * points at an item or a look (Bugün, plan, trips, stylist) stays consistent — only the pieces differ.
 */
function seedMenItems(): Item[] {
  return [
    item('item_white_shirt', 'Beyaz oxford gömlek', 'top', 'white', ['spring', 'autumn'], { subcategory: 'Gömlek', fabric: 'Pamuk', brand: 'Marks & Spencer', size: 'L', wearCount: 9 }),
    item('item_navy_blazer', 'Lacivert takım ceketi', 'outerwear', 'navy', ['autumn', 'winter'], { subcategory: 'Takım ceketi', fabric: 'Yün', brand: 'Vakko', size: 'L', wearCount: 6 }),
    item('item_black_midi', 'Lacivert ipek kravat', 'accessory', 'navy', ['spring', 'autumn', 'winter'], { subcategory: 'Kravat', fabric: 'İpek', size: null, wearCount: 4 }),
    item('item_straight_jeans', 'Koyu jean', 'bottom', 'blue', ['spring', 'summer', 'autumn', 'winter'], { subcategory: 'Jean', fabric: 'Denim', brand: 'Gap', size: 'L', wearCount: 12 }),
    item('item_cream_knit', 'Gri yün triko', 'top', 'grey', ['autumn', 'winter'], { subcategory: 'Triko', fabric: 'Yün', size: 'L', wearCount: 7 }),
    item('item_croc_flats', 'Kahve loafer', 'shoes', 'brown', ['spring', 'summer', 'autumn'], { subcategory: 'Loafer', size: '43', fabric: 'Deri', wearCount: 5 }),
    item('item_black_bag', 'Çelik saat', 'accessory', 'grey', ['spring', 'summer', 'autumn', 'winter'], { subcategory: 'Saat', size: null, wearCount: 14 }),
    item('item_tweed_jacket', 'Tüvit ceket', 'outerwear', 'beige', ['spring', 'autumn'], { subcategory: 'Ceket', fabric: 'Tüvit', size: 'L', wearCount: 3 }),
    item('item_beige_trench', 'Lacivert polo', 'top', 'navy', ['spring', 'summer'], { subcategory: 'Polo tişört', fabric: 'Pamuk', size: 'L', wearCount: 2 }),
    item('item_black_trousers', 'Bej chino', 'bottom', 'beige', ['spring', 'autumn', 'winter'], { subcategory: 'Chino pantolon', fabric: 'Pamuk', size: 'L', wearCount: 8 }),
    item('item_black_boots', 'Kahve bot', 'shoes', 'brown', ['autumn', 'winter'], { size: '43', fabric: 'Deri', wearCount: 6 }),
    item('item_white_sneakers', 'Beyaz sneaker', 'shoes', 'white', ['spring', 'summer', 'autumn'], { size: '43', wearCount: 10 }),
    item('item_silk_scarf', 'Kahve deri kemer', 'accessory', 'brown', ['spring', 'autumn'], { subcategory: 'Kemer', size: null, fabric: 'Deri', wearCount: 1 }),
    item('item_linen_shirt', 'Keten gömlek', 'top', 'beige', ['spring', 'summer'], { subcategory: 'Gömlek', fabric: 'Keten', size: 'L', wearCount: 0 }),
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

const LOOK_COVERS: Record<string, ShowcaseImage | undefined> = {
  look_lacivert_blazer: 'cover-navy-blazer',
  look_siyah_duz_elbise: 'cover-black-dress',
  look_tuvit_jean: 'cover-tweed-jean',
  look_krem_katmanlar: 'cover-cream-layers',
};
const ITEM_IMAGES: Record<string, ShowcaseImage | undefined> = {
  item_white_shirt: 'product-white-shirt',
  item_navy_blazer: 'product-navy-blazer',
  item_black_bag: 'product-black-bag',
  item_cream_knit: 'item-cream-knit',
  item_black_boots: 'item-black-boots',
  item_black_turtleneck: 'item-black-turtleneck',
  item_beige_trousers: 'item-beige-trousers',
  item_suede_bag: 'item-suede-bag',
  item_black_belt: 'item-black-belt',
  item_blue_knit: 'item-blue-knit',
  item_ecru_tee: 'item-ecru-tee',
  item_black_skirt: 'item-black-skirt',
  item_camel_coat: 'item-camel-coat',
  item_check_shirt: 'item-check-shirt',
};

function seedLooks(items: Item[], persona: FixturePersona = 'women'): Look[] {
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
    // Showcase build, women's wardrobe: the look's cover picture (as the AI look cover of the real app).
    ...(persona === 'women' && LOOK_COVERS[id] ? { coverImageUrl: showcaseImage(LOOK_COVERS[id]) } : {}),
    createdAt: CREATED,
    baseVersion: 1,
    ...extra,
  });
  if (persona === 'men') {
    return [
      look(
        'look_lacivert_blazer',
        'Lacivert Takım',
        'office',
        [
          ['top', 'item_white_shirt'],
          ['outerwear', 'item_navy_blazer'],
        ],
        { isFavorite: true, rating: 4.6, ratingCount: 12 },
      ),
      look(
        'look_siyah_duz_elbise',
        'Akşam Klasikleri',
        'evening',
        [
          ['top', 'item_white_shirt'],
          ['bottom', 'item_black_trousers'],
          ['accessory', 'item_black_midi'],
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
        'Gri Katmanlar',
        'office',
        [
          ['top', 'item_cream_knit'],
          ['bottom', 'item_black_trousers'],
          ['shoes', 'item_croc_flats'],
          ['accessory', 'item_black_bag'],
        ],
        { rating: 4.2, ratingCount: 5 },
      ),
    ];
  }
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
      // Shared to Akış (F2): the detail shows "Akışta yayında" and what it got there.
      { rating: 4.8, ratingCount: 9, sharedToFeed: true, feedStats: { likeCount: 38, saveCount: 12 } },
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

/** Which showcase account the fixtures stand in for: Damla (women, the default) or Emre (men, canvas 17). */
export type FixturePersona = 'women' | 'men';
let persona: FixturePersona = 'women';
export function fixturePersona(): FixturePersona {
  return persona;
}

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
  const items = persona === 'men' ? seedMenItems() : seedItems();
  return {
    items,
    looks: seedLooks(items, persona),
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

/**
 * Restores the seed (tests) or empties the wardrobe (to exercise empty states). `persona: 'men'` seeds the men's
 * showcase account (the showcase build switches when the signed-in style profile says `men`).
 */
export function resetFixtureDb(options: { empty?: boolean; persona?: FixturePersona } = {}): void {
  persona = options.persona ?? 'women';
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
