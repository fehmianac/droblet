import { fixtureCities } from '@/fixtures/trips';

import {
  foldForSearch,
  groupByCategory,
  monthGrid,
  pickRangeDate,
  readiness,
  searchCities,
  splitTrips,
  tripDates,
  tripLengthDays,
  validateTripDates,
} from './logic';

describe('city search', () => {
  it('folds Turkish letters for matching', () => {
    expect(foldForSearch('İSTANBUL')).toBe('istanbul');
    expect(foldForSearch('Iğdır')).toBe('igdir');
    expect(foldForSearch('  Çeşme ')).toBe('cesme');
  });

  it('is Turkish-insensitive: "ist", "İST" and "ıst" all find İstanbul', () => {
    for (const q of ['ist', 'İST', 'IST', 'ıst']) {
      expect(searchCities(fixtureCities, q).map((c) => c.name)).toEqual(['İstanbul']);
    }
    expect(searchCities(fixtureCities, 'izm').map((c) => c.name)).toEqual(['İzmir']);
  });

  it('matches aliases and keeps both Londons (board: Londra / London, Ontario)', () => {
    expect(searchCities(fixtureCities, 'Lond').map((c) => `${c.name} · ${c.region}`)).toEqual([
      'Londra · Birleşik Krallık',
      'London · Ontario, Kanada',
    ]);
    expect(searchCities(fixtureCities, 'rome').map((c) => c.name)).toEqual(['Roma']);
  });

  it('needs at least 2 characters and is a prefix match', () => {
    expect(searchCities(fixtureCities, 'l')).toEqual([]);
    expect(searchCities(fixtureCities, 'ondra')).toEqual([]);
  });
});

describe('trip dates', () => {
  it('counts days inclusively, across months and DST changes', () => {
    expect(tripLengthDays('2026-12-02', '2026-12-06')).toBe(5);
    expect(tripLengthDays('2026-12-30', '2027-01-02')).toBe(4);
    expect(tripLengthDays('2026-03-28', '2026-03-30')).toBe(3);
    expect(tripLengthDays('2026-12-02', '2026-12-02')).toBe(1);
  });

  it('validates the range: both dates, end ≥ start, max 30 days', () => {
    expect(validateTripDates(null, null)).toBe('startRequired');
    expect(validateTripDates('2026-12-02', null)).toBe('endRequired');
    expect(validateTripDates('2026-12-06', '2026-12-02')).toBe('endBeforeStart');
    expect(validateTripDates('2026-12-01', '2026-12-31')).toBe('tooLong');
    expect(validateTripDates('2026-12-01', '2026-12-30')).toBeNull();
    expect(validateTripDates('2026-12-02', '2026-12-02')).toBeNull();
  });

  it('lists every date of the trip', () => {
    expect(tripDates('2026-12-30', '2027-01-01')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
  });

  it('builds a Monday-first month grid', () => {
    const grid = monthGrid(2026, 11); // December 2026 starts on a Tuesday
    expect(grid[0]).toEqual([null, '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06']);
    expect(grid.flat().filter(Boolean)).toHaveLength(31);
    expect(grid.every((week) => week.length === 7)).toBe(true);
  });

  it('picking a start after the end clears the end; an end before the start becomes the start', () => {
    expect(pickRangeDate({ start: '2026-12-02', end: '2026-12-06' }, 'start', '2026-12-08')).toEqual({ start: '2026-12-08', end: null });
    expect(pickRangeDate({ start: '2026-12-02', end: '2026-12-06' }, 'start', '2026-12-04')).toEqual({ start: '2026-12-04', end: '2026-12-06' });
    expect(pickRangeDate({ start: '2026-12-05', end: null }, 'end', '2026-12-03')).toEqual({ start: '2026-12-03', end: null });
    expect(pickRangeDate({ start: '2026-12-02', end: null }, 'end', '2026-12-06')).toEqual({ start: '2026-12-02', end: '2026-12-06' });
  });
});

describe('readiness', () => {
  it('computes packed / total', () => {
    expect(readiness([{ packed: true }, { packed: false }, { packed: true }, { packed: false }])).toEqual({ packed: 2, total: 4, ratio: 0.5 });
  });

  it('is 0 for an empty list (no division by zero)', () => {
    expect(readiness([])).toEqual({ packed: 0, total: 0, ratio: 0 });
  });
});

describe('lists', () => {
  it('splits upcoming (soonest first) and past (latest first) trips', () => {
    const trips = [
      { id: 'a', startDate: '2026-10-01', endDate: '2026-10-04' },
      { id: 'b', startDate: '2026-12-20', endDate: '2026-12-25' },
      { id: 'c', startDate: '2026-11-17', endDate: '2026-11-18' },
      { id: 'd', startDate: '2026-09-01', endDate: '2026-09-03' },
    ];
    const { upcoming, past } = splitTrips(trips, '2026-11-18');
    expect(upcoming.map((t) => t.id)).toEqual(['c', 'b']);
    expect(past.map((t) => t.id)).toEqual(['a', 'd']);
  });

  it('groups the checklist by category in the given order and drops empty groups', () => {
    const item = (itemId: string, category: 'top' | 'shoes') => ({ itemId, name: itemId, category, color: 'black' as const, imageUrl: null, packed: false });
    const groups = groupByCategory([item('s', 'shoes'), item('t1', 'top'), item('t2', 'top')], ['top', 'bottom', 'shoes']);
    expect(groups.map((g) => [g.category, g.items.map((i) => i.itemId)])).toEqual([
      ['top', ['t1', 't2']],
      ['shoes', ['s']],
    ]);
  });
});
