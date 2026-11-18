/**
 * E4 Bugün, haftalık plan, takvim — the APP types the screens render. The wire shapes of the real
 * endpoints and the mappers are in `../wire/today.ts` (docs/api/wardrobe-looks-plan-stylist.md §5).
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

/**
 * PUT v1/tenant/plan-day/{date} `{ occasion, lookId, baseVersion }` — versioned (409 + the current record);
 * `lookId: null` + `occasion: null` clears the day, sent as DELETE v1/tenant/plan-day/{date}.
 */
export type PutPlanDayRequest = { occasion: Occasion | null; lookId: string | null; baseVersion: number; clientMutationId: string };

/** A "Bunu giyiyorum" record. GET v1/tenant/wear-log?month=yyyy-MM → `WearLog[]`. */
export type WearLog = {
  id: string;
  date: string;
  lookId: string | null;
  itemIds: string[];
  occurredAt: string;
};

/** POST v1/tenant/wear-log — event; idempotent on `clientMutationId` (= the log id). Exactly one of `lookId` / `itemIds`. */
export type CreateWearLogRequest = { id: string; date: string; occurredAt: string; lookId: string | null; itemIds: string[]; clientMutationId: string };

// ---------- 06 Bugün ----------

/** GET v1/tenant/today?date= mapped to the card's shape in `../contracts` (`TodayResponse`). */
export type Today = TodayResponse;

/**
 * "Başka öneri" on 06 — there is no `today/refresh`: the app starts a stylist job for the day
 * (`POST v1/tenant/stylist/outfit { requestId, date, occasion, onlyMyWardrobe }` → 202, members only)
 * and opens the suggestions screen (17) for it.
 */
export type RefreshTodayRequest = { date: string; requestId: string };

/**
 * Heart on 06 — the look's `favorite`. There is no narrow endpoint: the app reads the look and sends
 * the versioned `PUT v1/tenant/look/{id}` with only `favorite` changed.
 */
export type PutLookFavoriteRequest = { isFavorite: boolean; clientMutationId: string };

// ---------- 07 Haftalık plan ----------

/**
 * POST v1/tenant/stylist/week `{ requestId, weekStart, days?, onlyMyWardrobe }` → 202 job (members only, no credit).
 * The result is a draft: nothing is planned until `POST v1/tenant/stylist/week/{jobId}/accept { clientMutationId, dates }`.
 */
export type PlanWeekRequest = { requestId: string; weekStart: string; days: { date: string; occasion: Occasion | null }[] };
export type PlanWeekResponse = JobAccepted;
/**
 * Result of a `stylist-week` job: one proposed look per day that had none. `lookId` is empty for a
 * server draft (the look is created at accept); `jobId` is what the accept call needs.
 */
export type PlanWeekResult = { jobId?: string; days: { date: string; occasion: Occasion; lookId: string; lookName: string }[] };

// ---------- 09 Takvim ----------

/** GET v1/tenant/wear-log/summary?month=yyyy-MM (`loggedDays`, top-5 `mostWorn` on the wire; the screen shows the first). */
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
};

/** PUT v1/tenant/watch-list/{productId} `{ look: { kind: "edit", id } }` — replay-safe. `editLookId` = the edit look it was added from. */
export type AddWatchlistRequest = { productId: string; editLookId?: string; clientMutationId: string };

/**
 * Saving an edit look to the lookbook = `POST v1/tenant/look` with `source: "edit"`, id `id` and one
 * catalogue product per slot of the chosen price band (there is no `look/from-edit`). `editId` = the edit to read.
 */
export type SaveEditLookRequest = { id: string; editLookId: string; band: PriceBand; editId?: string; clientMutationId: string };
