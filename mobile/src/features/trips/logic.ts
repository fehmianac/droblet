import { TRIP_MAX_DAYS, type City, type Trip, type TripDetail, type TripItem } from '@/api/contracts/trips';
import type { ItemCategory } from '@/api/contracts/wardrobe';
import { isConsentRequired, isPaywallError, teenStylistErrorCode } from '@/api/errors';
import { parseLocalDate, toIsoDate } from '@/lib/format';

/**
 * Folds a string for city matching: lower-case, Turkish letters to their ASCII neighbours
 * (İ/I/ı → i, ş → s, ç → c, ğ → g, ü → u, ö → o) and other diacritics removed. Data matching only —
 * never used for display.
 */
export function foldForSearch(value: string): string {
  return value
    .replace(/[İIı]/g, 'i')
    .toLowerCase()
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

export type SearchableCity = City & { aliases?: readonly string[] };

export const CITY_QUERY_MIN = 2;

/**
 * The search result a typed city name stands for when the user did not tap one: the first result whose name is the
 * query (Turkish-insensitive, e.g. "londra" → Londra). Null when nothing matches exactly — the form then asks to pick.
 */
export function matchTypedCity<T extends City>(cities: readonly T[], query: string): T | null {
  const q = foldForSearch(query);
  if (q.length < CITY_QUERY_MIN) return null;
  return cities.find((c) => foldForSearch(c.name) === q) ?? null;
}

/** Prefix match on the city name or an alias ("lond" → Londra, London), Turkish-insensitive. */
export function searchCities<T extends SearchableCity>(cities: readonly T[], query: string, limit = 6): T[] {
  const q = foldForSearch(query);
  if (q.length < CITY_QUERY_MIN) return [];
  return cities
    .filter((c) => [c.name, ...(c.aliases ?? [])].some((n) => foldForSearch(n).startsWith(q)))
    .slice(0, limit);
}

const DAY_MS = 86_400_000;

/** Inclusive length in days of `start`…`end` (ISO dates). */
export function tripLengthDays(startDate: string, endDate: string): number {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  return Math.round((Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / DAY_MS) + 1;
}

export type DateRangeError = 'startRequired' | 'endRequired' | 'endBeforeStart' | 'tooLong';

export function validateTripDates(startDate: string | null, endDate: string | null): DateRangeError | null {
  if (!startDate) return 'startRequired';
  if (!endDate) return 'endRequired';
  const length = tripLengthDays(startDate, endDate);
  if (length < 1) return 'endBeforeStart';
  if (length > TRIP_MAX_DAYS) return 'tooLong';
  return null;
}

export function addDays(isoDate: string, days: number): string {
  const d = parseLocalDate(isoDate);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

/** Every ISO date of the trip, in order. */
export function tripDates(startDate: string, endDate: string): string[] {
  const length = Math.max(0, Math.min(tripLengthDays(startDate, endDate), TRIP_MAX_DAYS));
  return Array.from({ length }, (_, i) => addDays(startDate, i));
}

/**
 * Month grid for the date picker: weeks starting on `weekStartsOn` (0 = Sunday … 1 = Monday),
 * `null` for cells outside the month.
 */
export function monthGrid(year: number, month: number, weekStartsOn = 1): (string | null)[][] {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() - weekStartsOn + 7) % 7;
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => toIsoDate(new Date(year, month, i + 1))),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/**
 * Next range after tapping `date` while editing `field`. Picking a start after the current end
 * clears the end; picking an end before the start makes it the new start.
 */
export function pickRangeDate(
  range: { start: string | null; end: string | null },
  field: 'start' | 'end',
  date: string,
): { start: string | null; end: string | null } {
  if (field === 'start') {
    return { start: date, end: range.end && range.end >= date ? range.end : null };
  }
  if (!range.start || date < range.start) return { start: date, end: null };
  return { start: range.start, end: date };
}

export type Readiness = { packed: number; total: number; ratio: number };

/** Hazırlık halkası: packed / total (0 when the list is empty). */
export function readiness(items: Pick<TripItem, 'packed'>[]): Readiness {
  const total = items.length;
  const packed = items.filter((i) => i.packed).length;
  return { packed, total, ratio: total === 0 ? 0 : packed / total };
}

export function isPastTrip(trip: Pick<Trip, 'endDate'>, today: string): boolean {
  return trip.endDate < today;
}

export function splitTrips<T extends Pick<Trip, 'endDate' | 'startDate'>>(trips: T[], today: string): { upcoming: T[]; past: T[] } {
  const upcoming = trips.filter((t) => !isPastTrip(t, today)).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const past = trips.filter((t) => isPastTrip(t, today)).sort((a, b) => b.startDate.localeCompare(a.startDate));
  return { upcoming, past };
}

/** Checklist sections in wardrobe-category order. */
export function groupByCategory(items: TripItem[], order: readonly ItemCategory[]): { category: ItemCategory; items: TripItem[] }[] {
  return order.map((category) => ({ category, items: items.filter((i) => i.category === category) })).filter((g) => g.items.length > 0);
}

/** Localised pieces of the shared packing list; the caller supplies them from the translation files. */
export type TripShareLabels = {
  /** First line, e.g. "Londra bavulu · 2–6 Aralık · 5 gün". */
  title: string;
  listHeader: string;
  item: (name: string, packed: boolean) => string;
  looksHeader: string;
  look: (date: string, name: string) => string;
  missingHeader: string;
  missing: (name: string, reason: string) => string;
  footer: string;
};

/**
 * Readable text of a suitcase for the system share sheet (19 "Paylaş"): title, the packing list,
 * the daily looks and the missing pieces. Empty sections are left out. Plain text only — a trip is
 * private to its owner, so there is no link another person could open.
 */
export function tripShareText(trip: Pick<TripDetail, 'items' | 'days' | 'missing'>, labels: TripShareLabels): string {
  const sections: string[][] = [[labels.title]];
  if (trip.items.length > 0) sections.push([labels.listHeader, ...trip.items.map((i) => labels.item(i.name, i.packed))]);
  const looks = trip.days.flatMap((d) => (d.look ? [labels.look(d.date, d.look.name)] : []));
  if (looks.length > 0) sections.push([labels.looksHeader, ...looks]);
  if (trip.missing.length > 0) sections.push([labels.missingHeader, ...trip.missing.map((m) => labels.missing(m.name, m.reason))]);
  sections.push([labels.footer]);
  return sections.map((lines) => lines.join('\n')).join('\n\n');
}

/**
 * What the forecast row of 19 shows besides (or instead of) the daily strip:
 * - `null` — nothing (the strip alone; or a trip not confirmed yet / already over),
 * - `partial` — the strip plus a quiet "the rest isn't available yet",
 * - `notYet` — the trip is beyond the provider's 16-day horizon: a quiet "not available yet" (and only then),
 * - `noLocation` — the city could not be resolved: edit the trip and pick it from the list,
 * - `unavailable` — the provider failed (or an older server sent nothing): "couldn't be loaded right now".
 */
export type ForecastNotice = 'partial' | 'notYet' | 'noLocation' | 'unavailable' | null;

export function forecastNotice(trip: Pick<TripDetail, 'forecast' | 'forecastStatus' | 'baseVersion'>): ForecastNotice {
  const hasDays = Boolean(trip.forecast && trip.forecast.length > 0);
  switch (trip.forecastStatus) {
    case 'available':
    case 'past':
      return null;
    case 'partial':
      return hasDays ? 'partial' : 'notYet';
    case 'beyondRange':
      return 'notYet';
    case 'noLocation':
      return 'noLocation';
    case 'unavailable':
      return hasDays ? null : 'unavailable';
    default:
      // Optimistic trip (create still queued) or an older server without the forecast block.
      if (trip.baseVersion === 0) return null;
      return hasDays ? null : 'unavailable';
  }
}

/**
 * The state of the packing area of 19 after a failed start or a failed job:
 * - `paywall` — 403 `premium_required` (the paywall opens; the area offers it again),
 * - `consent` — 403 `consent_required` (the consent sheet opens; "Try again" afterwards),
 * - `wardrobe` — the job refused: the wardrobe cannot dress a single day (`insufficient_wardrobe`),
 * - `teenOff` / `teenLimit` — an approved teen: packing off for teens (`teen_stylist_unavailable`) or this week's used
 *   (`teen_stylist_weekly_limit`) — the calm 16w card, never the paywall,
 * - `failed` — anything else: credits, provider error, timeout, network, validation → the AI failure state with retry.
 */
export type PackErrorState = 'paywall' | 'consent' | 'wardrobe' | 'teenOff' | 'teenLimit' | 'failed';

export function packErrorState(error: unknown, jobErrorCode: string | null = null): PackErrorState {
  const teenCode = teenStylistErrorCode(error);
  if (teenCode === 'teen_stylist_unavailable') return 'teenOff';
  if (teenCode) return 'teenLimit';
  if (isPaywallError(error) || jobErrorCode === 'premium_required') return 'paywall';
  if (isConsentRequired(error) || jobErrorCode === 'consent_required') return 'consent';
  // `PackRefusedError` (wire/trips) — matched by name so this module stays free of the wire mappers.
  if (error instanceof Error && error.name === 'PackRefusedError' && (error as Error & { refusal?: string }).refusal === 'insufficient_wardrobe') {
    return 'wardrobe';
  }
  // 402 `credits_exhausted` (the credit sheet opens too), provider errors, timeouts, network, validation.
  return 'failed';
}
