import type { LibraryItem, TodayResponse } from '@/api/contracts';
import { toIsoDate } from '@/lib/format';

/**
 * Mock data for 06 Bugün and 04b İlk 5 parça. No backend contract exists yet for these (E4 / E2);
 * the shapes are the candidates in `api/contracts.ts`. Names are sample data from the design.
 */

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Monday-based week containing `today`. */
function weekOf(today: Date): Date[] {
  const mondayOffset = (today.getDay() + 6) % 7;
  const monday = addDays(today, -mondayOffset);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function buildTodayFixture(today: Date = new Date()): TodayResponse {
  const week = weekOf(today);
  return {
    date: toIsoDate(today),
    weather: { temperatureC: 14, city: 'İstanbul' },
    firstName: 'Damla',
    occasion: 'office',
    look: {
      id: 'look_lacivert_blazer',
      name: 'Lacivert Blazer',
      occasion: 'office',
      tryOnImageUrl: null,
      isFavorite: false,
      wornToday: false,
      pieces: [
        { id: 'item_blazer', name: 'Lacivert yün blazer', source: 'wardrobe', imageUrl: null },
        { id: 'item_shirt', name: 'Beyaz poplin gömlek', source: 'wardrobe', imageUrl: null },
        { id: 'item_trousers', name: 'Siyah kumaş pantolon', source: 'wardrobe', imageUrl: null },
        { id: 'prod_earrings', name: 'Küçük taşlı küpe', source: 'store', imageUrl: null },
      ],
    },
    week: week.map((d, i) => ({ date: toIsoDate(d), hasPlan: i < 4 })),
    weeklyEdit: [
      { id: 'edit_mon', date: toIsoDate(week[0] ?? today), name: 'Beyaz gömlek', imageUrl: null },
      { id: 'edit_tue', date: toIsoDate(week[1] ?? today), name: 'Siyah elbise', imageUrl: null },
      { id: 'edit_wed', date: toIsoDate(week[2] ?? today), name: 'Lacivert', imageUrl: null },
    ],
  };
}

export const libraryFixture: LibraryItem[] = [
  { id: 'lib_white_shirt', name: 'Beyaz poplin gömlek', category: 'top', imageUrl: null },
  { id: 'lib_navy_blazer', name: 'Lacivert yün blazer', category: 'outerwear', imageUrl: null },
  { id: 'lib_black_midi', name: 'Siyah midi elbise', category: 'dress', imageUrl: null },
  { id: 'lib_straight_jeans', name: 'Düz jean', category: 'bottom', imageUrl: null },
  { id: 'lib_cream_knit', name: 'Krem triko', category: 'top', imageUrl: null },
  { id: 'lib_croc_flats', name: 'Kroko babet', category: 'shoes', imageUrl: null },
  { id: 'lib_black_bag', name: 'Siyah deri çanta', category: 'bag', imageUrl: null },
  { id: 'lib_tweed_jacket', name: 'Tüvit ceket', category: 'outerwear', imageUrl: null },
  { id: 'lib_beige_trench', name: 'Bej trençkot', category: 'outerwear', imageUrl: null },
];

/** Simulated latency so loading skeletons are exercised in development. */
export function withLatency<T>(value: T, ms = 400): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
