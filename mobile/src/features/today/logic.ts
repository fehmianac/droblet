import type { TFunction } from 'i18next';

import { firstNameOf } from '@/api/wire/today';
import { sumMoney } from '@/lib/format';
import type { LookPiece, Occasion } from '@/api/contracts';
import type { Look } from '@/api/contracts/looks';
import type { CalendarMonth, EditProduct, PlanDay, WearLog } from '@/api/contracts/today';
import type { Item } from '@/api/contracts/wardrobe';
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
    /** Null when nothing is missing. */
    missingTotal: sumMoney(missing.map((p) => p.price)),
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

/**
 * 06: the piece thumbnails beside the try-on image. At most `max` (the board draws three); when the look
 * has a missing piece it is always among them, last, so the "EKSİK PARÇA" marker is never cut off.
 */
export function todayThumbs(pieces: LookPiece[], max = 3): LookPiece[] {
  const head = pieces.slice(0, max);
  const missing = pieces.find((p) => p.source === 'store');
  if (!missing || head.includes(missing)) return head;
  return [...pieces.filter((p) => p.source !== 'store').slice(0, max - 1), missing];
}

export type MonthReport = {
  /** Distinct days with at least one "Bunu giyiyorum" record. */
  daysLogged: number;
  daysInMonth: number;
  /** Distinct wardrobe pieces worn in the month. */
  piecesWorn: number;
  /** Distinct looks worn in the month. */
  looksWorn: number;
  /** Most worn pieces, most frequent first (ties keep wardrobe order). */
  topItems: { item: Item; count: number }[];
  /** Occasions of the worn looks, most frequent first. */
  occasions: { occasion: Occasion; count: number }[];
  /** Pieces that were in the wardrobe during the month and were never worn in it. */
  unworn: Item[];
};

/**
 * 09 "Rapor": one month read from the wear logs the calendar already has — nothing is fetched for it.
 * Logs of other months are ignored; pieces deleted from the wardrobe are left out of the lists.
 */
export function buildMonthReport(month: string, wearLogs: WearLog[], looks: Look[], items: Item[], limit = 5): MonthReport {
  const logs = wearLogs.filter((w) => w.date.startsWith(month));
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y ?? 1970, m ?? 1, 0).getDate();
  const monthEnd = `${month}-${String(daysInMonth).padStart(2, '0')}`;

  const itemCounts = new Map<string, number>();
  const occasionCountsMap = new Map<Occasion, number>();
  const lookIds = new Set<string>();
  logs.forEach((log) => {
    new Set(log.itemIds).forEach((id) => itemCounts.set(id, (itemCounts.get(id) ?? 0) + 1));
    const look = log.lookId ? looks.find((l) => l.id === log.lookId) : undefined;
    if (log.lookId) lookIds.add(log.lookId);
    if (look) occasionCountsMap.set(look.occasion, (occasionCountsMap.get(look.occasion) ?? 0) + 1);
  });

  const worn = items.filter((i) => itemCounts.has(i.id));
  return {
    daysLogged: new Set(logs.map((w) => w.date)).size,
    daysInMonth,
    piecesWorn: worn.length,
    looksWorn: lookIds.size,
    topItems: worn
      .map((item) => ({ item, count: itemCounts.get(item.id) ?? 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit),
    occasions: [...occasionCountsMap.entries()].map(([occasion, count]) => ({ occasion, count })).sort((a, b) => b.count - a.count),
    unworn: items.filter((i) => !itemCounts.has(i.id) && i.createdAt.slice(0, 10) <= monthEnd),
  };
}

// ---------- 06 greeting ----------

export type DayPart = 'Morning' | 'Day' | 'Evening';

export function dayPart(now: Date): DayPart {
  const h = now.getHours();
  if (h < 12) return 'Morning';
  if (h < 18) return 'Day';
  return 'Evening';
}

/**
 * The Bugün greeting. The name is the signed-in profile's own `displayName` (first word) — the
 * profile query is the source of truth, so a name edited on "Profili düzenle" shows at once — with
 * the name the card was built with as the fallback; without any name the greeting is neutral
 * ("Günaydın."). With a plan it runs into the day's occasion ("Günaydın Damla, / bugün ofis günü.").
 */
export function todayGreeting(
  t: TFunction,
  part: DayPart,
  names: { profileName: string | null | undefined; cardName: string | null | undefined },
  occasion: Occasion | null,
): string {
  const name = firstNameOf(names.profileName) || firstNameOf(names.cardName);
  if (occasion) {
    const head = name ? t(`today.greeting${part}`, { name }) : t(`todayHome.greetingNoName.${part}`);
    return `${head}\n${t(`today.occasionLine.${occasion}`)}`;
  }
  return name ? t(`todayHome.greetingAlone.${part}`, { name }) : t(`todayHome.greetingAloneNoName.${part}`);
}
