/**
 * E4 Bugün, haftalık plan, takvim — PROVISIONAL contract (BACKEND_ENGINEER §Uç nokta haritası, E4).
 * Calendar dates are `YYYY-MM-DD` in the user's local calendar.
 */
import type { Occasion } from '../contracts';

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
