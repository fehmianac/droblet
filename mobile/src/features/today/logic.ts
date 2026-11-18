import type { Occasion } from '@/api/contracts';
import type { Look } from '@/api/contracts/looks';
import type { CalendarMonth, EditProduct, PlanDay } from '@/api/contracts/today';
import type { TryOnTarget } from '@/api/contracts/tryon';

/** One row of 07: a date of the week joined with its plan record and the planned look. */
export type WeekRow = { date: string; plan: PlanDay | null; look: Look | null };

export function buildWeekRows(dates: string[], planDays: PlanDay[], looks: Look[]): WeekRow[] {
  return dates.map((date) => {
    const plan = planDays.find((p) => p.date === date) ?? null;
    const look = plan?.lookId ? (looks.find((l) => l.id === plan.lookId) ?? null) : null;
    return { date, plan, look };
  });
}

/** "Ofis ×4 · Akşam yemeği ×1" — occasions of the week, most frequent first. */
export function occasionCounts(rows: WeekRow[]): { occasion: Occasion; count: number }[] {
  const counts = new Map<Occasion, number>();
  rows.forEach((r) => {
    const occasion = r.plan?.occasion ?? r.look?.occasion;
    if (occasion) counts.set(occasion, (counts.get(occasion) ?? 0) + 1);
  });
  return [...counts.entries()].map(([occasion, count]) => ({ occasion, count })).sort((a, b) => b.count - a.count);
}

/**
 * Days that "Üzerimde gör · tüm hafta" will generate an image for: planned looks that have no
 * try-on image yet and no job already started in this session. One credit each (07b).
 */
export function weekTryOnTargets(rows: WeekRow[], alreadyStarted: readonly string[] = []): TryOnTarget[] {
  return rows
    .filter((r) => r.look !== null && r.look.tryOnImageUrl === null && !alreadyStarted.includes(r.date))
    .map((r) => ({ kind: 'plan-day' as const, id: r.date }));
}

/** Days "Haftamı planla" should fill: today or later, without a look. */
export function daysToPlan(rows: WeekRow[], today: string): { date: string; occasion: Occasion | null }[] {
  return rows.filter((r) => r.date >= today && r.look === null).map((r) => ({ date: r.date, occasion: r.plan?.occasion ?? null }));
}

/** 08: owned pieces are hidden unless the user asks; the total only ever counts the missing ones. */
export function editSummary(products: EditProduct[], showOwned: boolean) {
  const missing = products.filter((p) => p.ownedItemId === null);
  return {
    visible: showOwned ? products : missing,
    missing,
    ownedCount: products.length - missing.length,
    missingTotal: missing.reduce((sum, p) => sum + p.price, 0),
  };
}

export type DayStatus = { kind: 'worn' | 'planned'; lookId: string | null } | { kind: 'empty' };

/** 09: a wear log wins over a plan; a plan without a look counts as empty. */
export function dayStatus(date: string, month: Pick<CalendarMonth, 'wearLogs' | 'planDays'>): DayStatus {
  const log = month.wearLogs.find((w) => w.date === date);
  if (log) return { kind: 'worn', lookId: log.lookId };
  const plan = month.planDays.find((p) => p.date === date);
  if (plan?.lookId) return { kind: 'planned', lookId: plan.lookId };
  return { kind: 'empty' };
}
