import { ApiError } from '@/api/errors';
import { PackRefusedError } from '@/api/wire/trips';
import { fixtureCities } from '@/fixtures/trips';

import {
  forecastNotice,
  matchTypedCity,
  packErrorState,
  foldForSearch,
  groupByCategory,
  monthGrid,
  pickRangeDate,
  readiness,
  searchCities,
  splitTrips,
  tripDates,
  tripLengthDays,
  tripShareText,
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

  it('validates the range: both dates, end ≥ start, max 21 days', () => {
    expect(validateTripDates(null, null)).toBe('startRequired');
    expect(validateTripDates('2026-12-02', null)).toBe('endRequired');
    expect(validateTripDates('2026-12-06', '2026-12-02')).toBe('endBeforeStart');
    expect(validateTripDates('2026-12-01', '2026-12-22')).toBe('tooLong');
    expect(validateTripDates('2026-12-01', '2026-12-21')).toBeNull();
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

describe('tripShareText', () => {
  const labels = {
    title: 'Londra · 5 days',
    listHeader: 'Packing list',
    item: (name: string, packed: boolean) => (packed ? `- ${name} (packed)` : `- ${name}`),
    looksHeader: 'Daily looks',
    look: (date: string, name: string) => `${date}: ${name}`,
    missingHeader: 'Missing piece',
    missing: (name: string, reason: string) => `${name} · ${reason}`,
    footer: 'Prepared with Droblet.',
  };
  const item = (name: string, packed: boolean) => ({ itemId: name, name, category: 'top' as const, color: 'white' as const, imageUrl: null, packed });

  it('writes the list, the daily looks and the missing pieces as sections', () => {
    const text = tripShareText(
      {
        items: [item('Gömlek', true), item('Jean', false)],
        days: [
          { date: '2026-12-02', look: { id: 'l1', name: 'Ofis', occasion: 'office', imageUrl: null } },
          { date: '2026-12-03', look: null },
        ],
        missing: [{ id: 'm1', name: 'Yağmur botu', reason: '3 gün yağmur var', category: 'shoes', productId: null }],
      },
      labels,
    );
    expect(text).toBe(
      [
        'Londra · 5 days',
        'Packing list\n- Gömlek (packed)\n- Jean',
        'Daily looks\n2026-12-02: Ofis',
        'Missing piece\nYağmur botu · 3 gün yağmur var',
        'Prepared with Droblet.',
      ].join('\n\n'),
    );
  });

  it('leaves empty sections out', () => {
    expect(tripShareText({ items: [], days: [], missing: [] }, labels)).toBe('Londra · 5 days\n\nPrepared with Droblet.');
  });
});

const http = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  new ApiError('http', status, { type: `https://droblet.test/errors/${code}`, title: code, status, code, ...extra } as never);

describe('pack error → state', () => {
  it('sends premium_required to the paywall state', () => {
    expect(packErrorState(http(403, 'premium_required'))).toBe('paywall');
    expect(packErrorState(null, 'premium_required')).toBe('paywall');
  });

  it('sends consent_required to the consent state', () => {
    expect(packErrorState(http(403, 'consent_required', { missing: ['crossBorderTransfer'] }))).toBe('consent');
  });

  it('reads a refused draft with a too small wardrobe as the wardrobe state', () => {
    expect(packErrorState(new PackRefusedError('insufficient_wardrobe'))).toBe('wardrobe');
    expect(packErrorState(new PackRefusedError('out_of_scope'))).toBe('failed');
  });

  it('keeps the AI failure state with retry for credits, provider, timeout, network and validation errors', () => {
    expect(packErrorState(http(402, 'credits_exhausted'))).toBe('failed');
    expect(packErrorState(http(400, 'validation_failed', { errors: { requestId: ['request_id_invalid'] } }))).toBe('failed');
    expect(packErrorState(http(503, 'ai_unavailable'))).toBe('failed');
    expect(packErrorState(new ApiError('network', null, null))).toBe('failed');
    expect(packErrorState(null, 'provider_error')).toBe('failed');
    expect(packErrorState(null, 'timeout')).toBe('failed');
    expect(packErrorState(null, null)).toBe('failed');
  });
});

describe('forecast notice', () => {
  const day = { date: '2026-11-25', temperatureC: 9, condition: 'cloud' as const };
  const trip = (forecastStatus: Parameters<typeof forecastNotice>[0]['forecastStatus'], forecast: (typeof day)[] | null, baseVersion = 1) => ({
    forecastStatus,
    forecast,
    baseVersion,
  });

  it('shows the strip alone when every day is known (or the trip is over)', () => {
    expect(forecastNotice(trip('available', [day]))).toBeNull();
    expect(forecastNotice(trip('past', null))).toBeNull();
  });

  it('says "not available yet" only when the dates are beyond the provider horizon', () => {
    expect(forecastNotice(trip('beyondRange', null))).toBe('notYet');
    expect(forecastNotice(trip('partial', [day]))).toBe('partial');
    expect(forecastNotice(trip('unavailable', null))).toBe('unavailable');
    expect(forecastNotice(trip('noLocation', null))).toBe('noLocation');
  });

  it('stays quiet for an optimistic trip and falls back for an older server', () => {
    expect(forecastNotice(trip(undefined, null, 0))).toBeNull();
    expect(forecastNotice(trip(undefined, null))).toBe('unavailable');
    expect(forecastNotice(trip(undefined, [day]))).toBeNull();
  });
});

describe('typed city', () => {
  const results = [
    { id: '2643743', name: 'London', region: 'England, United Kingdom' },
    { id: '6058560', name: 'London', region: 'Ontario, Canada' },
    { id: '2643741', name: 'City of London', region: 'England, United Kingdom' },
  ];

  it('takes the first result named exactly like the query (case and Turkish letters folded)', () => {
    expect(matchTypedCity(results, ' london ')?.id).toBe('2643743');
    expect(matchTypedCity([{ id: '745044', name: 'İstanbul', region: '' }], 'istanbul')?.id).toBe('745044');
  });

  it('asks to pick from the list when nothing matches exactly', () => {
    expect(matchTypedCity(results, 'lond')).toBeNull();
    expect(matchTypedCity([], 'London')).toBeNull();
  });
});
