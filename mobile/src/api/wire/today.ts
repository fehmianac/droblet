/**
 * Wire shapes of Bugün / plan / wear log / calendar (docs/api/wardrobe-looks-plan-stylist.md §5, §6, §9)
 * and of the weekly edit (docs/api/store-social-settings.md §2), with the mappers to the app types of
 * `../contracts` and `../contracts/today`. Pure functions here; the requests live in the feature hooks.
 */
import type { LookPiece, Occasion, TodayLook, TodayResponse, WeeklyEditCard } from '../contracts';
import type { EditLook, EditProduct, PlanDay, PlanWeekResult, PriceBand, WearLog, WearSummary, WeeklyEdit } from '../contracts/today';
import type { ItemCategory } from '../contracts/wardrobe';
import type { PriceBandWire, ProductCategoryWire, ProductSlotWire, ProductWire } from './catalog';
import { toMoney } from './catalog';
import {
  toLookSlot,
  toOccasion,
  type ItemWire,
  type LookContext,
  type LookSlotInputWire,
  type LookSlotWire,
  type LookWire,
  type OccasionWire,
  type OutfitSlotWire,
} from './wardrobe';

// ---------- plan days, wear log ----------

export type WeatherConditionWire =
  | 'clear'
  | 'partlyCloudy'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'showers'
  | 'thunderstorm'
  | 'unknown';

/** Whole °C; one row per calendar day. */
export type WeatherWire = {
  date: string;
  minTempC: number;
  maxTempC: number;
  condition: WeatherConditionWire;
  precipitationChance: number | null;
};

/** `PlanDayDto` — GET v1/tenant/plan-day, PUT v1/tenant/plan-day/{date} (200 and the 409 body). */
export type PlanDayWire = {
  date: string;
  occasion: OccasionWire | null;
  lookId: string | null;
  look: LookWire | null;
  worn: boolean;
  version: number;
  updatedAt: string | null;
};

/** PUT v1/tenant/plan-day/{date}. `baseVersion: 0` creates. */
export type PutPlanDayWire = { occasion: OccasionWire | null; lookId: string | null; baseVersion: number };

export function toPlanDay(wire: PlanDayWire): PlanDay {
  return { date: wire.date, occasion: toOccasion(wire.occasion), lookId: wire.lookId, baseVersion: wire.version };
}

/** `WearLogDto` — same field names as the app's `WearLog`. */
export type WearLogWire = { id: string; date: string; lookId: string | null; itemIds: string[]; occurredAt: string };

/** POST v1/tenant/wear-log — exactly one of `lookId` / `itemIds` (≤ 10). The log id is `clientMutationId`. */
export type CreateWearLogWire = { clientMutationId: string; date: string; occurredAt: string; lookId?: string; itemIds?: string[] };
export type WearLogResultWire = { log: WearLogWire; items: { itemId: string; wearCount: number; lastWornAt: string | null }[] };

export function toWearLog(wire: WearLogWire): WearLog {
  return { id: wire.id, date: wire.date, lookId: wire.lookId, itemIds: wire.itemIds, occurredAt: wire.occurredAt };
}

/** GET v1/tenant/wear-log/summary?month= — `mostWorn` is the top 5, most days first. */
export type WearSummaryWire = {
  month: string;
  loggedDays: number;
  totalWears: number;
  mostWorn: { itemId: string; days: number; item: ItemWire | null }[];
};

export function toWearSummary(wire: WearSummaryWire): WearSummary {
  // A piece deleted since has no `item`; the summary line needs a name, so the next one is used.
  const top = wire.mostWorn.find((m) => m.item);
  return {
    month: wire.month,
    daysLogged: wire.loggedDays,
    mostWorn: top ? { itemId: top.itemId, name: top.item?.name ?? '', count: top.days } : null,
  };
}

// ---------- today ----------

/** GET v1/tenant/today?date= */
export type TodayWire = {
  date: string;
  season: string;
  weather: WeatherWire | null;
  occasion: OccasionWire | null;
  plan: PlanDayWire | null;
  look: LookWire | null;
  hasMissingPieces: boolean;
  missingPieces: LookSlotWire[];
  worn: boolean;
  week: { date: string; hasPlan: boolean; worn: boolean }[];
};

export function toTodayLook(wire: LookWire, ctx: LookContext, extra: { worn: boolean; tryOnImageUrl: string | null }): TodayLook {
  const pieces: LookPiece[] = wire.slots
    .map((s) => toLookSlot(s, ctx))
    // A deleted wardrobe piece has nothing to show on the card.
    .filter((s) => !(s.source === 'wardrobe' && s.deleted))
    .map((s) => ({ id: s.refId, name: s.name, source: s.source, imageUrl: s.imageUrl }));
  return {
    id: wire.id,
    name: wire.name,
    occasion: toOccasion(wire.occasion) ?? 'weekend',
    tryOnImageUrl: extra.tryOnImageUrl,
    pieces,
    isFavorite: wire.favorite,
    wornToday: extra.worn,
  };
}

/** What the Today card needs besides the `today` response itself. */
export type TodayExtras = {
  ctx: LookContext;
  firstName: string;
  /** Name of the profile city the forecast is for; '' when unknown. */
  cityName: string;
  tryOnImageUrl: string | null;
  weeklyEdit: WeeklyEditCard[];
};

export function toToday(wire: TodayWire, extras: TodayExtras): TodayResponse {
  return {
    date: wire.date,
    // The card shows one temperature: the day's high.
    weather: wire.weather ? { temperatureC: wire.weather.maxTempC, city: extras.cityName } : null,
    firstName: extras.firstName,
    occasion: toOccasion(wire.occasion),
    look: wire.look ? toTodayLook(wire.look, extras.ctx, { worn: wire.worn, tryOnImageUrl: extras.tryOnImageUrl }) : null,
    week: wire.week.map((d) => ({ date: d.date, hasPlan: d.hasPlan })),
    weeklyEdit: extras.weeklyEdit,
  };
}

/** "Damla Yılmaz" → "Damla". */
export function firstNameOf(displayName: string | null | undefined): string {
  return (displayName ?? '').trim().split(/\s+/)[0] ?? '';
}

// ---------- stylist week (job result `stylistWeek`) ----------

export type SuggestedOutfitWire = {
  index: number;
  /** Null for the rule-based fallback (`source: "rule"`). */
  title: string | null;
  explanation: string | null;
  source: 'model' | 'rule';
  slots: { slot: OutfitSlotWire; itemId: string | null; productId: string | null }[];
  missing: unknown[];
};

export type WeekResultWire = {
  weekStart: string;
  refusal: string | null;
  language: string;
  days: { date: string; occasion: OccasionWire | null; outfit: SuggestedOutfitWire | null }[];
};

/** POST v1/tenant/stylist/week → 202 `JobDto`. */
export type StartWeekWire = {
  requestId: string;
  weekStart: string;
  days?: { date: string; occasion: OccasionWire | null }[];
  onlyMyWardrobe: boolean;
};

/**
 * The week draft as the proposal sheet shows it: one row per day the stylist could dress. Nothing
 * exists on the server until `POST v1/tenant/stylist/week/{jobId}/accept`, so `lookId` is empty —
 * the looks get their ids at accept. `only` limits the rows to the days the user asked for.
 */
export function toPlanWeekResult(
  wire: WeekResultWire,
  options: { jobId: string; only?: readonly string[] | null; untitled: string },
): PlanWeekResult {
  return {
    jobId: options.jobId,
    days: wire.days
      .filter((d) => d.outfit !== null && (!options.only || options.only.includes(d.date)))
      .map((d) => ({
        date: d.date,
        occasion: toOccasion(d.occasion) ?? ('weekend' as Occasion),
        lookId: '',
        lookName: d.outfit?.title ?? options.untitled,
      })),
  };
}

// ---------- weekly edit (08) ----------

export type EditVariantWire = { priceBand: PriceBandWire; products: ProductWire[]; totalMinor: number; currency: string };
export type EditLookWire = {
  id: string;
  /** 1 = Monday … 7 = Sunday. */
  day: number;
  title: string;
  styleNote: string | null;
  imageUrl: string | null;
  variants: EditVariantWire[];
};
/** `EditDto` — GET v1/content/edit/current · GET v1/content/edit/{id}. 404 `not_found` when none. */
export type EditWire = {
  id: string;
  title: string;
  subtitle: string | null;
  coverImageUrl: string | null;
  weekStart: string;
  weekEnd: string;
  segment: string;
  sponsored: boolean;
  sponsorName: string | null;
  looks: EditLookWire[];
};

/** Catalogue category → wardrobe category (the server's own mapping, docs W §3 "from-product"). */
const WARDROBE_CATEGORY: Record<ProductCategoryWire, ItemCategory> = {
  tshirt: 'top',
  shirt: 'top',
  blouse: 'top',
  knitwear: 'top',
  sweatshirt: 'top',
  activewear: 'top',
  trousers: 'bottom',
  jeans: 'bottom',
  skirt: 'bottom',
  shorts: 'bottom',
  jacket: 'outerwear',
  coat: 'outerwear',
  dress: 'dress',
  swimwear: 'beachwear',
  skiwear: 'skiwear',
  shoes: 'shoes',
  bag: 'bag',
  accessory: 'accessory',
};

export function toWardrobeCategory(category: ProductCategoryWire): ItemCategory {
  return WARDROBE_CATEGORY[category] ?? 'accessory';
}

const BAND: Record<PriceBandWire, PriceBand> = { highStreet: 'high_street', luxuryTouch: 'luxury_touch' };

/** `2026-11-16` + 2 → `2026-11-18` (calendar arithmetic in UTC, no time zone involved). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10);
}

/** What the edit screen shows that the content endpoint does not know: it is per user. */
export type EditUserState = {
  /** productId → the wardrobe item bought from it. */
  ownedByProduct: Map<string, string>;
  watchedProductIds: Set<string>;
  /** Titles of the looks already saved from an edit (`source: "edit"`). */
  savedLookNames: Set<string>;
  hasBodyPhoto: boolean;
};

export const NO_EDIT_USER_STATE: EditUserState = {
  ownedByProduct: new Map(),
  watchedProductIds: new Set(),
  savedLookNames: new Set(),
  hasBodyPhoto: false,
};

function toEditProduct(wire: ProductWire, state: EditUserState): EditProduct {
  return {
    id: wire.id,
    brand: wire.brandName,
    name: wire.name,
    price: toMoney(wire.priceMinor, wire.currency) ?? { amountMinor: wire.priceMinor, currency: wire.currency },
    imageUrl: wire.images[0] ?? null,
    category: toWardrobeCategory(wire.category),
    color: wire.colors[0] ?? null,
    ownedItemId: state.ownedByProduct.get(wire.id) ?? null,
    inWatchlist: state.watchedProductIds.has(wire.id),
  };
}

function toEditLook(wire: EditLookWire, weekStart: string, state: EditUserState): EditLook {
  const products: Record<PriceBand, EditProduct[]> = { high_street: [], luxury_touch: [] };
  for (const variant of wire.variants) {
    const band = BAND[variant.priceBand];
    if (band) products[band] = variant.products.filter((p) => p.available).map((p) => toEditProduct(p, state));
  }
  return {
    id: wire.id,
    date: addDays(weekStart, Math.min(Math.max(wire.day, 1), 7) - 1),
    // The edit has no occasion field; weekdays read as office days, the weekend as weekend.
    occasion: wire.day >= 6 ? 'weekend' : 'office',
    name: wire.title,
    styleNote: wire.styleNote ?? '',
    // Try-on images are generated on demand (`POST v1/tenant/tryon`, target `editLook`).
    tryOnImageUrl: null,
    isSaved: state.savedLookNames.has(wire.title),
    products,
  };
}

export function toWeeklyEdit(wire: EditWire, state: EditUserState = NO_EDIT_USER_STATE): WeeklyEdit {
  return {
    id: wire.id,
    weekStart: wire.weekStart,
    weekEnd: wire.weekEnd,
    looks: [...wire.looks].sort((a, b) => a.day - b.day).map((l) => toEditLook(l, wire.weekStart, state)),
    hasBodyPhoto: state.hasBodyPhoto,
    // "SPONSORLU" on 08: the brand of a sponsored edit (`sponsorName`, in the request language).
    sponsoredBy: wire.sponsored ? (wire.sponsorName ?? null) : null,
  };
}

/** The Bugün strip: one card per edit look. */
export function toWeeklyEditCards(wire: EditWire): WeeklyEditCard[] {
  return [...wire.looks]
    .sort((a, b) => a.day - b.day)
    .map((l) => ({ id: l.id, date: addDays(wire.weekStart, l.day - 1), name: l.title, imageUrl: l.imageUrl }));
}

const LOOK_SLOT: Record<ProductSlotWire, OutfitSlotWire> = {
  top: 'top',
  bottom: 'bottom',
  outerwear: 'outerwear',
  shoes: 'shoes',
  bag: 'bagAccessory',
  accessory: 'bagAccessory',
  onePiece: 'top',
};

/**
 * Look slots for saving an edit look to the lookbook (`POST v1/tenant/look`, `source: "edit"`):
 * one catalogue product per look slot (the first of each), a one-piece goes in `top` and closes
 * `bottom`. The server needs at least two pieces.
 */
export function editLookSlots(look: EditLookWire, band: PriceBandWire): LookSlotInputWire[] {
  const variant = look.variants.find((v) => v.priceBand === band) ?? look.variants[0];
  if (!variant) return [];
  const bySlot = new Map<OutfitSlotWire, string>();
  let onePiece = false;
  for (const product of variant.products) {
    if (!product.available) continue;
    const slot = LOOK_SLOT[product.slot];
    if (!slot || bySlot.has(slot)) continue;
    if (product.slot === 'onePiece') onePiece = true;
    bySlot.set(slot, product.id);
  }
  // A one-piece that lost the `top` slot to a top is left out by the loop above; when it holds `top`, no bottom.
  if (onePiece && variant.products.find((p) => p.id === bySlot.get('top'))?.slot === 'onePiece') bySlot.delete('bottom');
  return [...bySlot.entries()].map(([slot, productId]) => ({ slot, productId }));
}

export function fromPriceBand(band: PriceBand): PriceBandWire {
  return band === 'luxury_touch' ? 'luxuryTouch' : 'highStreet';
}
