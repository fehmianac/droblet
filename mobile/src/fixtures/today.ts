import { moneyFromMajor , parseLocalDate, toIsoDate } from '@/lib/format';
import type { LibraryItem, LookPiece, Occasion, TodayLook, TodayResponse } from '@/api/contracts';
import type { Look } from '@/api/contracts/looks';
import type {
  CalendarMonth,
  EditLook,
  EditProduct,
  PlanDay,
  PlanWeekRequest,
  PlanWeekResult,
  PriceBand,
  SaveEditLookRequest,
  WearSummary,
  WeeklyEdit,
} from '@/api/contracts/today';
import type { ItemCategory } from '@/api/contracts/wardrobe';
import { clone, fixtureDb, FixtureNotFound, fixturePersona, onFixtureSeed } from '@/fixtures/db';
import { L } from '@/fixtures/showcase';

/**
 * Fixtures for the Bugün slice (06–09) and the ready-made library (04b / 12b). They read looks and
 * items from the shared `fixtureDb` and own its `planDays` / `wearLogs` collections. Names are
 * sample data from the design boards (server text is treated as already localized).
 */

function shift(isoDate: string, days: number): string {
  const d = parseLocalDate(isoDate);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

function mondayOf(isoDate: string): string {
  return shift(isoDate, -((parseLocalDate(isoDate).getDay() + 6) % 7));
}

/** Dev/test knobs for states the fixtures cannot reach otherwise. */
export const todayFixtureOptions: { hasBodyPhoto: boolean; sponsoredBy: string | null } = { hasBodyPhoto: true, sponsoredBy: null };

const watchlist = new Set<string>();
const savedEditLooks = new Set<string>();

// ---------- seed: plan days + wear logs relative to today ----------

const PLAN_SEED: [offset: number, occasion: Occasion, lookId: string | null][] = [
  [-2, 'office', 'look_krem_katmanlar'],
  [-1, 'office', 'look_siyah_duz_elbise'],
  [0, 'office', 'look_lacivert_blazer'],
  [1, 'dinner', null],
  [2, 'office', null],
];
const WORN_OFFSETS = [1, 2, 5, 7, 8, 9, 10, 14, 15, 16];
const WORN_LOOKS = ['look_siyah_duz_elbise', 'look_krem_katmanlar', 'look_lacivert_blazer'];

function wardrobeItemIds(look: Look | undefined): string[] {
  return look ? look.slots.filter((s) => s.source === 'wardrobe').map((s) => s.refId) : [];
}

onFixtureSeed((db, { empty }) => {
  watchlist.clear();
  savedEditLooks.clear();
  todayFixtureOptions.hasBodyPhoto = true;
  todayFixtureOptions.sponsoredBy = null;
  if (empty) return;
  const today = toIsoDate(new Date());
  const has = (id: string | null) => (id && db.looks.some((l) => l.id === id) ? id : null);
  db.planDays = PLAN_SEED.map(([offset, occasion, lookId]) => ({
    date: shift(today, offset),
    occasion,
    lookId: has(lookId),
    baseVersion: 1,
  }));
  db.wearLogs = WORN_OFFSETS.map((offset, i) => {
    const lookId = has(WORN_LOOKS[i % WORN_LOOKS.length] ?? null);
    const date = shift(today, -offset);
    return {
      id: `wear_${date}`,
      date,
      lookId,
      itemIds: wardrobeItemIds(db.looks.find((l) => l.id === lookId)),
      occurredAt: `${date}T06:30:00.000Z`,
    };
  });
});

// ---------- 06 Bugün ----------

/** The catalogue piece the stylist suggests to finish the blazer look (board 06 "Eksik parça"). */
const MISSING_PIECE: Record<string, LookPiece> = {
  look_lacivert_blazer: { id: 'prod_earrings', name: L('Küçük taşlı küpe'), source: 'store', imageUrl: null, category: 'accessory', color: 'other' },
};
/** The men's showcase account (canvas 17 · 06): loafers finish the suit. */
const MISSING_PIECE_MEN: Record<string, LookPiece> = {
  look_lacivert_blazer: { id: 'prod_loafers', name: L('Deri loafer'), source: 'store', imageUrl: null, category: 'loafers', color: 'brown' },
};

function todayLook(look: Look, date: string): TodayLook {
  const pieces: LookPiece[] = look.slots.map((s) => {
    const owned = s.source === 'wardrobe' ? fixtureDb.items.find((i) => i.id === s.refId) : undefined;
    return { id: s.refId, name: s.name, source: s.source, imageUrl: s.imageUrl, category: owned?.category ?? s.slot, color: owned?.color ?? null };
  });
  const missing = (fixturePersona() === 'men' ? MISSING_PIECE_MEN : MISSING_PIECE)[look.id];
  return {
    id: look.id,
    name: look.name,
    occasion: look.occasion,
    tryOnImageUrl: look.tryOnImageUrl,
    pieces: missing ? [...pieces, missing] : pieces,
    isFavorite: look.isFavorite,
    wornToday: fixtureDb.wearLogs.some((w) => w.date === date && w.lookId === look.id),
  };
}

export function buildTodayFixture(today: Date = new Date()): TodayResponse {
  const date = toIsoDate(today);
  const monday = mondayOf(date);
  const week = Array.from({ length: 7 }, (_, i) => shift(monday, i));
  const plan = fixtureDb.planDays.find((p) => p.date === date);
  const look = plan?.lookId ? fixtureDb.looks.find((l) => l.id === plan.lookId) : undefined;
  return clone({
    date,
    weather: { temperatureC: 14, city: L('İstanbul'), condition: 'partlyCloudy' },
    firstName: fixturePersona() === 'men' ? 'Emre' : 'Damla',
    occasion: look ? (plan?.occasion ?? look.occasion) : null,
    look: look ? todayLook(look, date) : null,
    week: week.map((d) => ({ date: d, hasPlan: fixtureDb.planDays.some((p) => p.date === d && p.lookId !== null) })),
    weeklyEdit: buildEditLooks(monday)
      .slice(0, 3)
      .map((l) => ({ id: l.id, date: l.date, name: l.name, imageUrl: l.tryOnImageUrl })),
  });
}

/** "Başka öneri": swaps today's planned look for the next one in the lookbook. */
export function fixtureRefreshToday(date: string): TodayResponse {
  const plan = fixtureDb.planDays.find((p) => p.date === date);
  const looks = fixtureDb.looks;
  if (plan && looks.length > 0) {
    const index = looks.findIndex((l) => l.id === plan.lookId);
    plan.lookId = looks[(index + 1) % looks.length]?.id ?? plan.lookId;
    plan.baseVersion += 1;
  }
  return buildTodayFixture(parseLocalDate(date));
}

export function fixtureSetLookFavorite(lookId: string, isFavorite: boolean): void {
  const look = fixtureDb.looks.find((l) => l.id === lookId);
  if (!look) throw new FixtureNotFound(`look ${lookId}`);
  look.isFavorite = isFavorite;
}

/** Mirrors `POST v1/tenant/wear-log` for the fixture calendar (the queued write itself lives in src/sync). */
export function fixtureLogWear(lookId: string, date: string, occurredAt: string): void {
  if (fixtureDb.wearLogs.some((w) => w.date === date && w.lookId === lookId)) return;
  fixtureDb.wearLogs.push({
    id: `wear_${date}_${lookId}`,
    date,
    lookId,
    itemIds: wardrobeItemIds(fixtureDb.looks.find((l) => l.id === lookId)),
    occurredAt,
  });
}

// ---------- 07 Haftalık plan ----------

export function fixtureListPlanDays(from: string, to: string): PlanDay[] {
  return clone(fixtureDb.planDays.filter((p) => p.date >= from && p.date <= to));
}

export function fixturePutPlanDay(date: string, occasion: Occasion | null, lookId: string | null): PlanDay | null {
  const index = fixtureDb.planDays.findIndex((p) => p.date === date);
  const previous = index >= 0 ? fixtureDb.planDays[index] : undefined;
  if (occasion === null && lookId === null) {
    if (index >= 0) fixtureDb.planDays.splice(index, 1);
    return null;
  }
  const next: PlanDay = { date, occasion, lookId, baseVersion: (previous?.baseVersion ?? 0) + 1 };
  if (index >= 0) fixtureDb.planDays[index] = next;
  else fixtureDb.planDays.push(next);
  return clone(next);
}

/** "Haftamı planla": proposes a look for every requested day, preferring one made for the day's occasion. */
export function fixturePlanWeek(request: PlanWeekRequest): PlanWeekResult {
  const looks = fixtureDb.looks;
  if (looks.length === 0) return { days: [] };
  return {
    days: request.days.map((day, i) => {
      const fallback = looks[i % looks.length] as Look;
      const look = looks.find((l) => l.occasion === day.occasion) ?? fallback;
      return { date: day.date, occasion: day.occasion ?? look.occasion, lookId: look.id, lookName: look.name };
    }),
  };
}

// ---------- 09 Takvim ----------

export function fixtureWearSummary(month: string): WearSummary {
  const logs = fixtureDb.wearLogs.filter((w) => w.date.startsWith(month));
  const counts = new Map<string, number>();
  logs.forEach((w) => w.itemIds.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1)));
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const item = top ? fixtureDb.items.find((i) => i.id === top[0]) : undefined;
  return {
    month,
    daysLogged: new Set(logs.map((w) => w.date)).size,
    mostWorn: top && item ? { itemId: item.id, name: item.name, count: top[1] } : null,
  };
}

export function fixtureCalendarMonth(month: string): CalendarMonth {
  return clone({
    month,
    wearLogs: fixtureDb.wearLogs.filter((w) => w.date.startsWith(month)),
    planDays: fixtureDb.planDays.filter((p) => p.date.startsWith(month)),
    summary: fixtureWearSummary(month),
  });
}

// ---------- 08 Haftanın edit'i ----------

type ProductSeed = [id: string, brand: string, name: string, price: number, category: ItemCategory, ownedItemId: string | null];
type LookSeed = { name: string; occasion: Occasion; note: string; high: ProductSeed[]; luxury: ProductSeed[] };

const SHIRT: ProductSeed = ['prod_poplin_shirt', 'Marks & Spencer', 'Beyaz Poplin Gömlek', 1890, 'top', 'item_white_shirt'];
const TROUSERS: ProductSeed = ['prod_high_trousers', 'Gap', 'Yüksek Bel Kumaş Pantolon', 2450, 'bottom', 'item_black_trousers'];

const EDIT_SEED: LookSeed[] = [
  {
    name: 'Beyaz Gömlek, Net Çizgi',
    occasion: 'office',
    note: 'Beyaz poplin gömleği yüksek belli pantolonun içine yerleştir; kroko babet ve siyah çantayla sade tut.',
    high: [SHIRT, TROUSERS, ['prod_croc_flats', 'Marks & Spencer', 'Deri Kroko Babet', 3300, 'shoes', null], ['prod_city_bag', 'Beymen Club', 'City Medium Siyah Çanta', 12950, 'bag', null]],
    luxury: [SHIRT, TROUSERS, ['prod_lux_flats', 'Vakko', 'Kroko Desen Deri Babet', 14900, 'shoes', null], ['prod_lux_bag', 'Vakko', 'Yapılı Deri Çanta', 38500, 'bag', null]],
  },
  {
    name: 'Siyah Düz Elbise',
    occasion: 'office',
    note: 'Siyah midi elbiseyi ince bir kemerle topla; blazer omuzda kalsın.',
    high: [['prod_midi_dress', 'Gap', 'Siyah Midi Elbise', 3990, 'dress', 'item_black_midi'], ['prod_slim_belt', 'Marks & Spencer', 'İnce Deri Kemer', 890, 'accessory', null]],
    luxury: [['prod_midi_dress', 'Gap', 'Siyah Midi Elbise', 3990, 'dress', 'item_black_midi'], ['prod_lux_belt', 'Beymen Club', 'Tokalı Deri Kemer', 6400, 'accessory', null]],
  },
  {
    name: 'Lacivert',
    occasion: 'office',
    note: 'Lacivert blazerı krem trikoyla yumuşat; altına düz jean yeter.',
    high: [['prod_navy_blazer', 'Vakko', 'Lacivert Yün Blazer', 9800, 'outerwear', 'item_navy_blazer'], ['prod_loafers', 'Marks & Spencer', 'Deri Loafer', 3650, 'shoes', null]],
    luxury: [['prod_navy_blazer', 'Vakko', 'Lacivert Yün Blazer', 9800, 'outerwear', 'item_navy_blazer'], ['prod_lux_loafers', 'Beymen Club', 'Tokalı Deri Loafer', 18750, 'shoes', null]],
  },
  {
    name: 'Akşam Yemeği',
    occasion: 'dinner',
    note: 'Saten gömleği siyah pantolonla eşle; küçük taşlı küpe tek aksesuar olsun.',
    high: [TROUSERS, ['prod_satin_shirt', 'Gap', 'Saten Gömlek', 2290, 'top', null], ['prod_earrings', 'Marks & Spencer', 'Küçük Taşlı Küpe', 750, 'accessory', null]],
    luxury: [TROUSERS, ['prod_lux_satin', 'Vakko', 'İpek Saten Gömlek', 11900, 'top', null], ['prod_lux_earrings', 'Beymen Club', 'Taşlı Altın Küpe', 9200, 'accessory', null]],
  },
  {
    name: 'Krem Katmanlar',
    occasion: 'office',
    note: 'Krem trikonun üzerine bej trençkot; tonları yakın tut.',
    high: [['prod_cream_knit', 'Gap', 'Krem Triko', 1990, 'top', 'item_cream_knit'], ['prod_ankle_boots', 'Marks & Spencer', 'Deri Bilekte Bot', 4850, 'shoes', null]],
    luxury: [['prod_cream_knit', 'Gap', 'Krem Triko', 1990, 'top', 'item_cream_knit'], ['prod_lux_boots', 'Vakko', 'Süet Bilekte Bot', 21500, 'shoes', null]],
  },
  {
    name: 'Tüvit & Jean',
    occasion: 'weekend',
    note: 'Tüvit ceketi düz jean ve beyaz sneaker ile rahatlat.',
    high: [['prod_jeans', 'Gap', 'Düz Kesim Jean', 2190, 'bottom', 'item_straight_jeans'], ['prod_tote', 'Marks & Spencer', 'Kanvas Tote Çanta', 1450, 'bag', null]],
    luxury: [['prod_jeans', 'Gap', 'Düz Kesim Jean', 2190, 'bottom', 'item_straight_jeans'], ['prod_lux_tote', 'Beymen Club', 'Deri Tote Çanta', 16900, 'bag', null]],
  },
  {
    name: 'Pazar Sakinliği',
    occasion: 'weekend',
    note: 'Keten gömlek, düz jean ve fular: rahat ama derli toplu.',
    high: [['prod_linen_shirt', 'Gap', 'Keten Gömlek', 1790, 'top', 'item_linen_shirt'], ['prod_sandals', 'Marks & Spencer', 'Deri Sandalet', 2650, 'shoes', null]],
    luxury: [['prod_linen_shirt', 'Gap', 'Keten Gömlek', 1790, 'top', 'item_linen_shirt'], ['prod_lux_sandals', 'Vakko', 'El Yapımı Deri Sandalet', 12400, 'shoes', null]],
  },
];

/** The men's weekly edit of the showcase account (canvas 17 · 06: Oxford gömlek, Koyu chino, Lacivert…). */
const OXFORD: ProductSeed = ['prod_oxford_shirt', 'Marks & Spencer', 'Beyaz Oxford Gömlek', 1890, 'top', 'item_white_shirt'];
const CHINOS: ProductSeed = ['prod_chinos', 'Gap', 'Koyu Chino Pantolon', 2150, 'bottom', 'item_black_trousers'];
const EDIT_SEED_MEN: LookSeed[] = [
  {
    name: 'Oxford Gömlek',
    occasion: 'office',
    note: 'Beyaz oxford gömleği chino ile eşle; kahve loafer ve deri kemerle sade tut.',
    high: [OXFORD, CHINOS, ['prod_loafers', 'Marks & Spencer', 'Deri Loafer', 3650, 'shoes', null], ['prod_belt_m', 'Gap', 'Deri Kemer', 890, 'accessory', null]],
    luxury: [OXFORD, CHINOS, ['prod_lux_loafers', 'Beymen Club', 'Tokalı Deri Loafer', 18750, 'shoes', null], ['prod_lux_belt', 'Beymen Club', 'Tokalı Deri Kemer', 6400, 'accessory', null]],
  },
  {
    name: 'Koyu Chino',
    occasion: 'office',
    note: 'Koyu chinoyu gri trikoyla yumuşat; saat tek aksesuar olsun.',
    high: [CHINOS, ['prod_grey_knit', 'Gap', 'Gri Yün Triko', 1990, 'top', 'item_cream_knit']],
    luxury: [CHINOS, ['prod_lux_knit', 'Vakko', 'Kaşmir Triko', 9900, 'top', null]],
  },
  {
    name: 'Lacivert',
    occasion: 'office',
    note: 'Lacivert takım ceketini beyaz gömlek ve ipek kravatla tamamla.',
    high: [['prod_suit_jacket', 'Vakko', 'Lacivert Takım Ceketi', 9800, 'outerwear', 'item_navy_blazer'], ['prod_tie', 'Marks & Spencer', 'İpek Kravat', 1250, 'accessory', null]],
    luxury: [['prod_suit_jacket', 'Vakko', 'Lacivert Takım Ceketi', 9800, 'outerwear', 'item_navy_blazer'], ['prod_lux_tie', 'Beymen Club', 'El Yapımı İpek Kravat', 4900, 'accessory', null]],
  },
  {
    name: 'Akşam Yemeği',
    occasion: 'dinner',
    note: 'Koyu gömleği chino ile eşle; deri loafer akşamı tamamlar.',
    high: [CHINOS, ['prod_dark_shirt', 'Gap', 'Koyu Gömlek', 2290, 'top', null]],
    luxury: [CHINOS, ['prod_lux_shirt', 'Vakko', 'Poplin Gömlek', 7900, 'top', null]],
  },
  {
    name: 'Gri Katmanlar',
    occasion: 'office',
    note: 'Gri trikonun altına beyaz gömlek; tonları yakın tut.',
    high: [['prod_grey_knit', 'Gap', 'Gri Yün Triko', 1990, 'top', 'item_cream_knit'], ['prod_boots_m', 'Marks & Spencer', 'Deri Bot', 4850, 'shoes', null]],
    luxury: [['prod_grey_knit', 'Gap', 'Gri Yün Triko', 1990, 'top', 'item_cream_knit'], ['prod_lux_boots_m', 'Vakko', 'Süet Bot', 21500, 'shoes', null]],
  },
  {
    name: 'Tüvit & Jean',
    occasion: 'weekend',
    note: 'Tüvit ceketi koyu jean ve beyaz sneaker ile rahatlat.',
    high: [['prod_jeans', 'Gap', 'Düz Kesim Jean', 2190, 'bottom', 'item_straight_jeans'], ['prod_backpack', 'Marks & Spencer', 'Kanvas Sırt Çantası', 1450, 'bag', null]],
    luxury: [['prod_jeans', 'Gap', 'Düz Kesim Jean', 2190, 'bottom', 'item_straight_jeans'], ['prod_lux_backpack', 'Beymen Club', 'Deri Sırt Çantası', 16900, 'bag', null]],
  },
  {
    name: 'Pazar Sakinliği',
    occasion: 'weekend',
    note: 'Keten gömlek, koyu jean ve polo: rahat ama derli toplu.',
    high: [['prod_linen_shirt', 'Gap', 'Keten Gömlek', 1790, 'top', 'item_linen_shirt'], ['prod_sandals', 'Marks & Spencer', 'Deri Sandalet', 2650, 'shoes', null]],
    luxury: [['prod_linen_shirt', 'Gap', 'Keten Gömlek', 1790, 'top', 'item_linen_shirt'], ['prod_lux_sandals', 'Vakko', 'El Yapımı Deri Sandalet', 12400, 'shoes', null]],
  },
];

/** Main colour of the edit's placeholder products (ground of the picture placeholder). */
const PRODUCT_COLOR: Record<string, string> = {
  prod_poplin_shirt: 'white',
  prod_high_trousers: 'black',
  prod_croc_flats: 'brown',
  prod_city_bag: 'black',
  prod_lux_flats: 'brown',
  prod_lux_bag: 'black',
  prod_midi_dress: 'black',
  prod_slim_belt: 'brown',
  prod_lux_belt: 'black',
  prod_navy_blazer: 'navy',
  prod_loafers: 'brown',
  prod_lux_loafers: 'black',
  prod_satin_shirt: 'cream',
  prod_lux_satin: 'cream',
  prod_cream_knit: 'cream',
  prod_ankle_boots: 'brown',
  prod_lux_boots: 'beige',
  prod_jeans: 'blue',
  prod_tote: 'beige',
  prod_lux_tote: 'brown',
  prod_linen_shirt: 'beige',
  prod_sandals: 'brown',
  prod_lux_sandals: 'brown',
  prod_oxford_shirt: 'white',
  prod_chinos: 'brown',
  prod_belt_m: 'brown',
  prod_grey_knit: 'grey',
  prod_lux_knit: 'grey',
  prod_suit_jacket: 'navy',
  prod_tie: 'navy',
  prod_lux_tie: 'navy',
  prod_dark_shirt: 'navy',
  prod_lux_shirt: 'white',
  prod_boots_m: 'brown',
  prod_lux_boots_m: 'brown',
  prod_backpack: 'beige',
  prod_lux_backpack: 'brown',
};

function product([id, brand, name, price, category, ownedItemId]: ProductSeed): EditProduct {
  return {
    id,
    brand,
    name: L(name),
    price: moneyFromMajor(price, 'TRY'),
    imageUrl: null,
    category,
    color: PRODUCT_COLOR[id] ?? null,
    ownedItemId: ownedItemId && fixtureDb.items.some((i) => i.id === ownedItemId) ? ownedItemId : null,
    inWatchlist: watchlist.has(id),
  };
}

function buildEditLooks(weekStart: string): EditLook[] {
  return (fixturePersona() === 'men' ? EDIT_SEED_MEN : EDIT_SEED).map((seed, i) => {
    const id = `edit_${weekStart}_${i + 1}`;
    return {
      id,
      date: shift(weekStart, i),
      occasion: seed.occasion,
      name: L(seed.name),
      styleNote: L(seed.note),
      tryOnImageUrl: null,
      isSaved: savedEditLooks.has(id),
      products: { high_street: seed.high.map(product), luxury_touch: seed.luxury.map(product) },
    };
  });
}

export function fixtureWeeklyEdit(id: string, today: Date = new Date()): WeeklyEdit {
  const weekStart = id.startsWith('weekly_') ? id.slice('weekly_'.length) : mondayOf(toIsoDate(today));
  if (id !== 'current' && !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw new FixtureNotFound(`edit ${id}`);
  return clone({
    id: `weekly_${weekStart}`,
    weekStart,
    weekEnd: shift(weekStart, 6),
    looks: buildEditLooks(weekStart),
    hasBodyPhoto: todayFixtureOptions.hasBodyPhoto,
    sponsoredBy: todayFixtureOptions.sponsoredBy,
  });
}

export function fixtureAddToWatchlist(productId: string): void {
  watchlist.add(productId);
}

/** Saves an edit look to the lookbook; pieces the user owns become wardrobe slots, the rest store slots. */
export function fixtureSaveEditLook(request: SaveEditLookRequest): void {
  if (savedEditLooks.has(request.editLookId)) return;
  const weekStart = request.editLookId.split('_')[1] ?? '';
  const source = buildEditLooks(weekStart).find((l) => l.id === request.editLookId);
  if (!source) throw new FixtureNotFound(`edit look ${request.editLookId}`);
  const band: PriceBand = request.band;
  const slotOf: Partial<Record<ItemCategory, Look['slots'][number]['slot']>> = {
    top: 'top',
    dress: 'top',
    bottom: 'bottom',
    outerwear: 'outerwear',
    shoes: 'shoes',
    bag: 'accessory',
    accessory: 'accessory',
  };
  const used = new Set<string>();
  const slots: Look['slots'] = [];
  for (const p of source.products[band]) {
    const slot = slotOf[p.category];
    if (!slot || used.has(slot)) continue;
    used.add(slot);
    slots.push({
      slot,
      source: p.ownedItemId ? 'wardrobe' : 'store',
      refId: p.ownedItemId ?? p.id,
      name: p.name,
      imageUrl: p.imageUrl,
      brand: p.brand,
      price: p.ownedItemId ? null : p.price,
      deleted: false,
    });
  }
  savedEditLooks.add(request.editLookId);
  fixtureDb.looks.push({
    id: request.id,
    name: source.name,
    occasion: source.occasion,
    slots,
    isFavorite: true,
    rating: null,
    ratingCount: 0,
    tryOnImageUrl: null,
    createdAt: new Date().toISOString(),
    baseVersion: 1,
  });
}

// ---------- 04b / 12b ready-made library ----------

export const libraryFixture: LibraryItem[] = [
  { id: 'lib_white_shirt', name: L('Beyaz poplin gömlek'), category: 'top', imageUrl: null, color: 'white' },
  { id: 'lib_navy_blazer', name: L('Lacivert yün blazer'), category: 'outerwear', imageUrl: null, color: 'navy' },
  { id: 'lib_black_midi', name: L('Siyah midi elbise'), category: 'dress', imageUrl: null, color: 'black' },
  { id: 'lib_straight_jeans', name: L('Düz jean'), category: 'bottom', imageUrl: null, color: 'blue' },
  { id: 'lib_cream_knit', name: L('Krem triko'), category: 'top', imageUrl: null, color: 'cream' },
  { id: 'lib_croc_flats', name: L('Kroko babet'), category: 'shoes', imageUrl: null, color: 'brown' },
  { id: 'lib_black_bag', name: L('Siyah deri çanta'), category: 'bag', imageUrl: null, color: 'black' },
  { id: 'lib_tweed_jacket', name: L('Tüvit ceket'), category: 'outerwear', imageUrl: null, color: 'grey' },
  { id: 'lib_beige_trench', name: L('Bej trençkot'), category: 'outerwear', imageUrl: null, color: 'beige' },
];

/** The men's library of canvas 17 · 12b (pictures come later: every piece shows its glyph). */
export const menLibraryFixture: LibraryItem[] = [
  { id: 'lib_m_basic_tee', name: L('Basic tişört'), category: 'top', subcategory: 't-shirt', imageUrl: null, color: 'white' },
  { id: 'lib_m_oxford_shirt', name: L('Oxford gömlek'), category: 'top', subcategory: 'shirt', imageUrl: null, color: 'blue' },
  { id: 'lib_m_polo', name: L('Polo tişört'), category: 'top', subcategory: 'polo', imageUrl: null, color: 'navy' },
  { id: 'lib_m_crew_knit', name: L('Bisiklet yaka triko'), category: 'top', subcategory: 'sweater', imageUrl: null, color: 'grey' },
  { id: 'lib_m_suit_jacket', name: L('Takım ceketi'), category: 'outerwear', subcategory: 'suit-jacket', imageUrl: null, color: 'navy' },
  { id: 'lib_m_coat', name: L('Kaban'), category: 'outerwear', subcategory: 'coat', imageUrl: null, color: 'grey' },
  { id: 'lib_m_chinos', name: L('Chino pantolon'), category: 'bottom', subcategory: 'chinos', imageUrl: null, color: 'beige' },
  { id: 'lib_m_jeans', name: L('Düz paça jean'), category: 'bottom', subcategory: 'jeans', imageUrl: null, color: 'blue' },
  { id: 'lib_m_loafers', name: L('Loafer'), category: 'shoes', subcategory: 'loafers', imageUrl: null, color: 'brown' },
  { id: 'lib_m_sneakers', name: L('Sneaker'), category: 'shoes', subcategory: 'sneakers', imageUrl: null, color: 'white' },
  { id: 'lib_m_tie', name: L('Kravat'), category: 'accessory', subcategory: 'tie', imageUrl: null, color: 'navy' },
  { id: 'lib_m_watch', name: L('Saat'), category: 'accessory', subcategory: 'watch', imageUrl: null, color: 'grey' },
];

/** Simulated latency so loading skeletons are exercised in development. */
export function withLatency<T>(value: T, ms = 400): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
