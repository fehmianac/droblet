import type { TFunction } from 'i18next';

import { currentLocaleTag } from '@/i18n';

/** Prices are shown in ₺ with tr-TR grouping, e.g. ₺26.550 (MOBILE_ENGINEER §Tasarımdan gelen kurallar). */
export function formatTry(amount: number): string {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

/** Parses a wire date `YYYY-MM-DD` as a local calendar date (no UTC shift). */
export function parseLocalDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function part(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(currentLocaleTag(), options).format(date);
}

/** "18 Kasım Çarşamba" (TR) / "Wednesday, November 18" (EN) — order comes from the translation file. */
export function formatLongDate(date: Date, t: TFunction): string {
  return t('dateFormat.long', {
    day: String(date.getDate()),
    month: part(date, { month: 'long' }),
    weekday: part(date, { weekday: 'long' }),
  });
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
