/**
 * E4 Bugün, haftalık plan, takvim — PROVISIONAL contract (BACKEND_ENGINEER §Uç nokta haritası, E4).
 * Calendar dates are `YYYY-MM-DD` in the user's local calendar.
 */
import type { Money } from '@/lib/format';
import type { Occasion, TodayResponse } from '../contracts';
import type { JobAccepted } from './jobs';
import type { ItemCategory } from './wardrobe';

/** One planned day. GET v1/tenant/plan-day?from=&to= → `PlanDay[]` (only days that have a record). */
export type PlanDay = {
  date: string;
  occasion: Occasion | null;
  /** The look planned for the day (an entry of GET v1/tenant/look). */
  lookId: string | null;
  baseVersion: number;
};

/** PUT v1/tenant/plan-day/{date} — versioned (409). `lookId: null` + `occasion: null` clears the day. */
export type PutPlanDayRequest = { occasion: Occasion | null; lookId: string | null; baseVersion: number; clientMutationId: string };

/** A "Bunu giyiyorum" record. GET v1/tenant/wear-log?month=yyyy-MM → `WearLog[]`. */
export type WearLog = {
  id: string;
  date: string;
  lookId: string | null;
  itemIds: string[];
  occurredAt: string;
};

/** POST v1/tenant/wear-log — event; idempotent on `clientMutationId`. */
export type CreateWearLogRequest = { id: string; date: string; occurredAt: string; lookId: string | null; itemIds: string[]; clientMutationId: string };

// ---------- 06 Bugün ----------

/** GET v1/tenant/today?date= — the shape in `../contracts` (`TodayResponse`), unchanged. */
export type Today = TodayResponse;

/**
 * "Başka öneri" on 06 — ASSUMPTION: `POST v1/tenant/today/refresh { date, requestId }` → `TodayResponse`
 * with another look for the day (text suggestion, no credit). May become a `stylist/outfit` job instead.
 */
export type RefreshTodayRequest = { date: string; requestId: string };

/**
 * Heart on 06 — the look's `isFavorite`. ASSUMPTION: `PUT v1/tenant/look/{id}/favorite { isFavorite,
 * clientMutationId }` (a narrow, idempotent write so the card does not need the whole versioned look).
 */
export type PutLookFavoriteRequest = { isFavorite: boolean; clientMutationId: string };

// ---------- 07 Haftalık plan ----------

/** POST v1/tenant/stylist/week → 202. The result is a draft: nothing is planned until the user accepts. */
export type PlanWeekRequest = { requestId: string; weekStart: string; days: { date: string; occasion: Occasion | null }[] };
export type PlanWeekResponse = JobAccepted;
/** Result of a `stylist-week` job: one proposed look per day that had none. */
export type PlanWeekResult = { days: { date: string; occasion: Occasion; lookId: string; lookName: string }[] };

// ---------- 09 Takvim ----------

/** GET v1/tenant/wear-log/summary?month=yyyy-MM */
export type WearSummary = {
  month: string;
  daysLogged: number;
  mostWorn: { itemId: string; name: string; count: number } | null;
};

/** What 09 needs for one month (three GETs on the API side, combined by the app). */
export type CalendarMonth = { month: string; wearLogs: WearLog[]; planDays: PlanDay[]; summary: WearSummary };

// ---------- 08 Haftanın edit'i (global content, language-partitioned) ----------

export const PRICE_BANDS = ['high_street', 'luxury_touch'] as const;
export type PriceBand = (typeof PRICE_BANDS)[number];

export type EditProduct = {
  id: string;
  brand: string;
  name: string;
  /** Current catalogue price (minor units + ISO currency). */
  price: Money;
  imageUrl: string | null;
  category: ItemCategory;
  /** Set when the user already owns an equivalent piece (WardrobeMatchRules) — hidden by default on 08. */
  ownedItemId: string | null;
  inWatchlist: boolean;
};

export type EditLook = {
  id: string;
  /** The day of the week this look is for. */
  date: string;
  occasion: Occasion;
  name: string;
  styleNote: string;
  /** Owner-only try-on of this look; null until generated. */
  tryOnImageUrl: string | null;
  /** Saved to the user's lookbook. */
  isSaved: boolean;
  products: Record<PriceBand, EditProduct[]>;
};

/** GET v1/content/edit/current · GET v1/content/edit/{id} */
export type WeeklyEdit = {
  id: string;
  weekStart: string;
  weekEnd: string;
  looks: EditLook[];
  /** False → "Profil fotoğrafını tamamla" card instead of the try-on image. */
  hasBodyPhoto: boolean;
  /**
   * Brand of a sponsored edit (BRIEF: `weekly_edit.sponsor`, faz 3) → the "SPONSORLU" label on 08.
   * ASSUMPTION: optional on the wire; absent or null = an editorial edit.
   */
  sponsoredBy?: string | null;
};

/** ASSUMPTION (24b belongs to the store slice): POST v1/tenant/watchlist — idempotent on clientMutationId. */
export type AddWatchlistRequest = { productId: string; clientMutationId: string };

/** ASSUMPTION: POST v1/tenant/look/from-edit — saves an edit look to the lookbook as a Look with id `id`. */
export type SaveEditLookRequest = { id: string; editLookId: string; band: PriceBand; clientMutationId: string };
