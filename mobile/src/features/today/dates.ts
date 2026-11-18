import { parseLocalDate, toIsoDate } from '@/lib/format';

/** Calendar maths on wire dates (`YYYY-MM-DD`, local calendar). No formatting here — see `@/lib/format`. */

export function addDays(isoDate: string, days: number): string {
  const d = parseLocalDate(isoDate);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

/** Monday of the week containing `isoDate`. */
export function weekStartOf(isoDate: string): string {
  const d = parseLocalDate(isoDate);
  return addDays(isoDate, -((d.getDay() + 6) % 7));
}

/** The seven dates (Monday → Sunday) of the week containing `isoDate`. */
export function weekDates(isoDate: string): string[] {
  const start = weekStartOf(isoDate);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** `yyyy-MM` of a wire date. */
export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y ?? 1970, (m ?? 1) - 1 + delta, 1);
  return toIsoDate(d).slice(0, 7);
}

export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y ?? 1970, m ?? 1, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/**
 * Month grid, Monday first: rows of 7 cells, `null` for the leading / trailing blanks.
 * e.g. November 2026 starts on a Sunday → six leading blanks.
 */
export function monthGrid(month: string): (string | null)[][] {
  const { from, to } = monthBounds(month);
  const lead = (parseLocalDate(from).getDay() + 6) % 7;
  const days = Number(to.slice(8));
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}
