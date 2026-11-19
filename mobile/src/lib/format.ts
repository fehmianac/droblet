import type { TFunction } from 'i18next';

import { currentLocaleTag } from '@/i18n';

/**
 * THE locale-aware formatting helpers. Every date, weekday/month name, number, percentage,
 * temperature and price shown to the user goes through this file, which formats with Intl in the ACTIVE app language
 * (`currentLocaleTag()`; Turkish by default). Never concatenate these by hand and never pass a fixed
 * locale to Intl in a screen. Counts with a noun ("86 parça") are i18next plurals, not formatted here.
 */

/** Plain number in the active locale: `formatNumber(4.6, { maximumFractionDigits: 1 })` → "4,6" (TR) / "4.6" (EN). */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(currentLocaleTag(), options).format(value);
}

/** Money as the API sends it: an integer amount in the currency's minor unit + ISO 4217 code. */
export type Money = { amountMinor: number; currency: string };

const fractionDigitsCache = new Map<string, number>();

/** Minor-unit exponent of a currency (TRY 2, JPY 0, KWD 3), from the platform's currency data. */
function minorUnitDigits(currency: string): number {
  const cached = fractionDigitsCache.get(currency);
  if (cached !== undefined) return cached;
  let digits = 2;
  try {
    digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    // Unknown code: assume two decimals.
  }
  fractionDigitsCache.set(currency, digits);
  return digits;
}

/** `moneyFromMajor(3000, 'TRY')` → `{ amountMinor: 300000, currency: 'TRY' }` (fixtures, tests, store prices). */
export function moneyFromMajor(amount: number, currency: string): Money {
  return { amountMinor: Math.round(amount * 10 ** minorUnitDigits(currency)), currency };
}

/**
 * THE money path: every price, subtotal and total on screen. The currency's narrow symbol, grouped
 * for the active locale — ₺26.550 / ₺199,99 (TR), ₺26,550 (EN); whole amounts show no decimals.
 * Never concatenate "₺" by hand.
 */
export function formatMoney(money: Money): string {
  const digits = minorUnitDigits(money.currency);
  const amount = money.amountMinor / 10 ** digits;
  const whole = Number.isInteger(amount);
  const fraction = { minimumFractionDigits: whole ? 0 : digits, maximumFractionDigits: whole ? 0 : digits };
  try {
    return new Intl.NumberFormat(currentLocaleTag(), {
      style: 'currency',
      currency: money.currency,
      currencyDisplay: 'narrowSymbol',
      ...fraction,
    }).format(amount);
  } catch {
    return `${formatNumber(amount, fraction)} ${money.currency}`;
  }
}

/** Adds amounts of one currency (a cart or an outfit is priced in a single currency). Null when empty. */
export function sumMoney(values: (Money | null)[]): Money | null {
  const priced = values.filter((v): v is Money => v !== null);
  const first = priced[0];
  if (!first) return null;
  return {
    currency: first.currency,
    amountMinor: priced.filter((v) => v.currency === first.currency).reduce((sum, v) => sum + v.amountMinor, 0),
  };
}

/** "%64" (TR) / "64%" (EN) from a 0–100 value. Never concatenate "%" by hand. */
export function formatPercent(value: number): string {
  return new Intl.NumberFormat(currentLocaleTag(), { style: 'percent', maximumFractionDigits: 0 }).format(value / 100);
}

/** Temperature in whole degrees Celsius, "14°" (weather badges, forecasts). */
export function formatTemperature(celsius: number): string {
  // Not `Intl` unit formatting: Hermes renders the narrow "degree" unit as "14 deg" in English. The
  // degree sign is locale-neutral.
  return `${formatNumber(Math.round(celsius))}°`;
}

/** Parses a wire date `YYYY-MM-DD` as a local calendar date (no UTC shift). */
export function parseLocalDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** Any Intl date format in the active locale, e.g. `formatDate(d, { day: 'numeric', month: 'short' })` → "18 Kas" / "18 Nov". */
export function formatDate(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(currentLocaleTag(), options).format(date);
}

const part = formatDate;

/** "18 Kasım Çarşamba" (TR) / "Wednesday, November 18" (EN) — order comes from the translation file. */
export function formatLongDate(date: Date, t: TFunction): string {
  return t('dateFormat.long', {
    day: part(date, { day: 'numeric' }),
    month: part(date, { month: 'long' }),
    weekday: part(date, { weekday: 'long' }),
  });
}

/** "Kasım 2026" / "November 2026" (calendar titles). */
export function formatMonthYear(date: Date): string {
  return part(date, { month: 'long', year: 'numeric' });
}

/** "Kasım 2026" from a wire month `YYYY-MM`. */
export function formatYearMonth(month: string): string {
  return formatMonthYear(parseLocalDate(`${month}-01`));
}

/** "1 Aralık" / "1 December". */
export function formatDayMonth(date: Date): string {
  return part(date, { day: 'numeric', month: 'long' });
}

/** "Kasım" / "November". */
export function formatMonthName(date: Date): string {
  return part(date, { month: 'long' });
}

/** "12–16 Ara" / "12–16 Dec"; falls back to "12 Ara – 16 Ara" where `formatRange` is unavailable. */
export function formatDateRange(start: Date, end: Date, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  const formatter = new Intl.DateTimeFormat(currentLocaleTag(), options);
  if (typeof formatter.formatRange === 'function') {
    try {
      return formatter.formatRange(start, end);
    } catch {
      // fall through
    }
  }
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

/** Wire dates `YYYY-MM-DD` with full month names: "9–15 Kasım" within a month, "28 Kasım – 4 Aralık" across months. */
export function formatIsoDateRange(startIso: string, endIso: string): string {
  const start = parseLocalDate(startIso);
  const end = parseLocalDate(endIso);
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${part(start, { day: 'numeric' })}–${formatDayMonth(end)}`;
  }
  return `${formatDayMonth(start)} – ${formatDayMonth(end)}`;
}

export type RelativeTime = { unit: 'now' } | { unit: 'minutes' | 'hours' | 'days'; count: number };

/** Coarse "2 saat önce" buckets for feed timestamps (wire time is UTC ISO-8601); the words are i18next plurals. */
export function relativeTime(iso: string, now: Date = new Date()): RelativeTime {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return { unit: 'now' };
  if (minutes < 60) return { unit: 'minutes', count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: 'hours', count: hours };
  return { unit: 'days', count: Math.floor(hours / 24) };
}

export function weekdayShort(date: Date): string {
  return part(date, { weekday: 'short' }).replace('.', '');
}

export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

/** Northern-hemisphere meteorological season (market: Türkiye). */
export function seasonOf(date: Date): Season {
  const m = date.getMonth();
  if (m === 11 || m <= 1) return 'winter';
  if (m <= 4) return 'spring';
  if (m <= 7) return 'summer';
  return 'autumn';
}

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
