import { currentLocaleTag } from '@/i18n';

import { parseLocalDate } from './format';

function fmt(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(currentLocaleTag(), options).format(date);
}

/** "1 Aralık" / "1 December". */
export function formatDayMonth(date: Date): string {
  return fmt(date, { day: 'numeric', month: 'long' });
}

/** "Kasım" / "November". */
export function formatMonthName(date: Date): string {
  return fmt(date, { month: 'long' });
}

/** "Kasım 2026" from a wire month `YYYY-MM`. */
export function formatYearMonth(month: string): string {
  return fmt(parseLocalDate(`${month}-01`), { month: 'long', year: 'numeric' });
}

/** "9–15 Kasım" within one month, "28 Kasım – 4 Aralık" across months (wire dates `YYYY-MM-DD`). */
export function formatDateRange(startIso: string, endIso: string): string {
  const start = parseLocalDate(startIso);
  const end = parseLocalDate(endIso);
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${start.getDate()}–${end.getDate()} ${formatMonthName(end)}`;
  }
  return `${formatDayMonth(start)} – ${formatDayMonth(end)}`;
}

export type RelativeTime =
  | { unit: 'now' }
  | { unit: 'minutes' | 'hours' | 'days'; count: number };

/** Coarse "2 saat önce" buckets for feed timestamps (wire time is UTC ISO-8601). */
export function relativeTime(iso: string, now: Date = new Date()): RelativeTime {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return { unit: 'now' };
  if (minutes < 60) return { unit: 'minutes', count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: 'hours', count: hours };
  return { unit: 'days', count: Math.floor(hours / 24) };
}
