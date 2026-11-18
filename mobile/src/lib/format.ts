import type { TFunction } from 'i18next';

import { currentLocaleTag } from '@/i18n';

/**
 * The locale-aware formatting helpers. Every date, weekday/month name, number, temperature and
 * price shown to the user goes through this file, which formats with Intl in the ACTIVE app language
 * (`currentLocaleTag()`; Turkish by default). Never concatenate these by hand and never pass a fixed
 * locale to Intl in a screen. Counts with a noun ("86 parça") are i18next plurals, not formatted here.
 */

/** Plain number in the active locale: `formatNumber(4.6, { maximumFractionDigits: 1 })` → "4,6" (TR) / "4.6" (EN). */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(currentLocaleTag(), options).format(value);
}

/**
 * Prices are in Turkish lira with the ₺ symbol, grouped for the active locale: ₺26.550 (TR) /
 * ₺26,550 (EN). Whole amounts show no decimals.
 */
export function formatTry(amount: number): string {
  const whole = amount % 1 === 0;
  return new Intl.NumberFormat(currentLocaleTag(), {
    style: 'currency',
    currency: 'TRY',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: whole ? 0 : 2,
    minimumFractionDigits: whole ? 0 : 2,
  }).format(amount);
}

/** Temperature in whole degrees Celsius, "14°" (weather badges, forecasts). */
export function formatTemperature(celsius: number): string {
  const rounded = Math.round(celsius);
  try {
    return new Intl.NumberFormat(currentLocaleTag(), { style: 'unit', unit: 'degree', unitDisplay: 'narrow' }).format(rounded);
  } catch {
    // Engines without unit formatting: the degree sign is locale-neutral.
    return `${formatNumber(rounded)}°`;
  }
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
