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
import { clone, fixtureDb, FixtureNotFound, onFixtureSeed } from '@/fixtures/db';

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
export const todayFixtureOptions: { hasBodyPhoto: boolean } = { hasBodyPhoto: true };

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
  look_lacivert_blazer: { id: 'prod_earrings', name: 'Küçük taşlı küpe', source: 'store', imageUrl: null },
};

function todayLook(look: Look, date: string): TodayLook {
  const pieces: LookPiece[] = look.slots.map((s) => ({ id: s.refId, name: s.name, source: s.source, imageUrl: s.imageUrl }));
  const missing = MISSING_PIECE[look.id];
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
    weather: { temperatureC: 14, city: 'İstanbul' },
    firstName: 'Damla',
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

function product([id, brand, name, price, category, ownedItemId]: ProductSeed): EditProduct {
  return {
    id,
    brand,
    name,
    price: moneyFromMajor(price, 'TRY'),
    imageUrl: null,
    category,
    ownedItemId: ownedItemId && fixtureDb.items.some((i) => i.id === ownedItemId) ? ownedItemId : null,
    inWatchlist: watchlist.has(id),
  };
}

function buildEditLooks(weekStart: string): EditLook[] {
  return EDIT_SEED.map((seed, i) => {
    const id = `edit_${weekStart}_${i + 1}`;
    return {
      id,
      date: shift(weekStart, i),
      occasion: seed.occasion,
      name: seed.name,
      styleNote: seed.note,
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
  { id: 'lib_white_shirt', name: 'Beyaz poplin gömlek', category: 'top', imageUrl: null },
  { id: 'lib_navy_blazer', name: 'Lacivert yün blazer', category: 'outerwear', imageUrl: null },
  { id: 'lib_black_midi', name: 'Siyah midi elbise', category: 'dress', imageUrl: null },
  { id: 'lib_straight_jeans', name: 'Düz jean', category: 'bottom', imageUrl: null },
  { id: 'lib_cream_knit', name: 'Krem triko', category: 'top', imageUrl: null },
  { id: 'lib_croc_flats', name: 'Kroko babet', category: 'shoes', imageUrl: null },
  { id: 'lib_black_bag', name: 'Siyah deri çanta', category: 'bag', imageUrl: null },
  { id: 'lib_tweed_jacket', name: 'Tüvit ceket', category: 'outerwear', imageUrl: null },
  { id: 'lib_beige_trench', name: 'Bej trençkot', category: 'outerwear', imageUrl: null },
];

/** Simulated latency so loading skeletons are exercised in development. */
export function withLatency<T>(value: T, ms = 400): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
