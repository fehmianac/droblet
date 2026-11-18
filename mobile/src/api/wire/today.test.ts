import type { Item } from '../contracts/wardrobe';
import type { ProductWire } from './catalog';
import {
  addDays,
  editLookSlots,
  firstNameOf,
  toPlanDay,
  toPlanWeekResult,
  toToday,
  toWearSummary,
  toWeeklyEdit,
  toWeeklyEditCards,
  type EditWire,
  type TodayWire,
  type WeekResultWire,
} from './today';
import type { LookWire } from './wardrobe';

const product = (id: string, slot: ProductWire['slot'], category: ProductWire['category'], extra: Partial<ProductWire> = {}): ProductWire => ({
  id,
  brandId: 'gap',
  brandName: 'Gap',
  name: `Ürün ${id}`,
  description: null,
  category,
  slot,
  colors: ['white'],
  sizes: ['S', 'M'],
  priceMinor: 100000,
  currency: 'TRY',
  previousPriceMinor: null,
  priceBand: 'highStreet',
  images: [`https://cdn.example/${id}.jpg`],
  available: true,
  createdAt: '2026-11-18T09:00:00Z',
  ...extra,
});

const look: LookWire = {
  id: '01LOOK',
  name: 'Ofis',
  occasion: 'office',
  slots: [
    { slot: 'top', itemId: 'i1', productId: null, missing: false, unavailable: false },
    { slot: 'bottom', itemId: 'gone', productId: null, missing: false, unavailable: true },
    { slot: 'bagAccessory', itemId: null, productId: 'p-bag', missing: true, unavailable: false },
  ],
  pieceCount: 2,
  hasMissingPieces: true,
  favorite: true,
  source: 'user',
  createdAt: '2026-11-01T09:00:00Z',
  updatedAt: '2026-11-01T09:00:00Z',
  version: 3,
  rating: null,
};

const item = { id: 'i1', name: 'Beyaz gömlek', imageUrl: 'https://img/i1', brand: null } as Item;

describe('today wire mappers', () => {
  it('maps a plan day (version → baseVersion)', () => {
    expect(
      toPlanDay({ date: '2026-11-18', occasion: 'office', lookId: '01LOOK', look, worn: false, version: 2, updatedAt: '2026-11-18T08:00:00Z' }),
    ).toEqual({ date: '2026-11-18', occasion: 'office', lookId: '01LOOK', baseVersion: 2 });
  });

  it('maps GET v1/tenant/today to the Bugün card', () => {
    const wire: TodayWire = {
      date: '2026-11-18',
      season: 'autumn',
      weather: { date: '2026-11-18', minTempC: 8, maxTempC: 14, condition: 'rain', precipitationChance: 70 },
      occasion: 'office',
      plan: null,
      look,
      hasMissingPieces: true,
      missingPieces: [],
      worn: true,
      week: [{ date: '2026-11-18', hasPlan: true, worn: true }],
    };
    const today = toToday(wire, {
      ctx: { items: new Map([['i1', item]]), products: new Map([['p-bag', product('p-bag', 'bag', 'bag', { name: 'Deri çanta' })]]) },
      firstName: 'Damla',
      cityName: 'İstanbul',
      tryOnImageUrl: null,
      weeklyEdit: [],
    });
    expect(today.weather).toEqual({ temperatureC: 14, city: 'İstanbul' });
    expect(today.firstName).toBe('Damla');
    expect(today.week).toEqual([{ date: '2026-11-18', hasPlan: true }]);
    expect(today.look).toMatchObject({ id: '01LOOK', occasion: 'office', isFavorite: true, wornToday: true });
    // The deleted wardrobe piece is dropped; the catalogue piece is a "store" piece.
    expect(today.look?.pieces).toEqual([
      { id: 'i1', name: 'Beyaz gömlek', source: 'wardrobe', imageUrl: 'https://img/i1' },
      { id: 'p-bag', name: 'Deri çanta', source: 'store', imageUrl: 'https://cdn.example/p-bag.jpg' },
    ]);
  });

  it('no plan and no forecast read as nulls', () => {
    const today = toToday(
      { date: '2026-11-18', season: 'autumn', weather: null, occasion: null, plan: null, look: null, hasMissingPieces: false, missingPieces: [], worn: false, week: [] },
      { ctx: { items: new Map(), products: new Map() }, firstName: '', cityName: '', tryOnImageUrl: null, weeklyEdit: [] },
    );
    expect(today).toMatchObject({ weather: null, look: null, occasion: null });
  });

  it('takes the first name of a display name', () => {
    expect(firstNameOf('Damla Yılmaz')).toBe('Damla');
    expect(firstNameOf(null)).toBe('');
  });

  it('maps the month summary: first most-worn piece that still exists', () => {
    const summary = toWearSummary({
      month: '2026-11',
      loggedDays: 10,
      totalWears: 31,
      mostWorn: [
        { itemId: 'deleted', days: 7, item: null },
        { itemId: 'i1', days: 6, item: { id: 'i1', name: 'Beyaz gömlek' } as never },
      ],
    });
    expect(summary).toEqual({ month: '2026-11', daysLogged: 10, mostWorn: { itemId: 'i1', name: 'Beyaz gömlek', count: 6 } });
    expect(toWearSummary({ month: '2026-11', loggedDays: 0, totalWears: 0, mostWorn: [] }).mostWorn).toBeNull();
  });

  it('maps a stylist-week result to the proposal rows the user asked for', () => {
    const wire: WeekResultWire = {
      weekStart: '2026-11-16',
      refusal: null,
      language: 'tr',
      days: [
        { date: '2026-11-16', occasion: 'office', outfit: { index: 0, title: 'Gece Laciverti', explanation: '…', source: 'model', slots: [], missing: [] } },
        { date: '2026-11-17', occasion: null, outfit: { index: 0, title: null, explanation: null, source: 'rule', slots: [], missing: [] } },
        { date: '2026-11-18', occasion: 'dinner', outfit: null },
        { date: '2026-11-19', occasion: 'dinner', outfit: { index: 0, title: 'X', explanation: null, source: 'model', slots: [], missing: [] } },
      ],
    };
    expect(toPlanWeekResult(wire, { jobId: 'J1', only: ['2026-11-16', '2026-11-17', '2026-11-18'], untitled: 'Günün kombini' })).toEqual({
      jobId: 'J1',
      days: [
        { date: '2026-11-16', occasion: 'office', lookId: '', lookName: 'Gece Laciverti' },
        { date: '2026-11-17', occasion: 'weekend', lookId: '', lookName: 'Günün kombini' },
      ],
    });
  });

  const edit: EditWire = {
    id: 'edit-2026-w47',
    title: 'Sonbahar katmanları',
    subtitle: null,
    coverImageUrl: null,
    weekStart: '2026-11-16',
    weekEnd: '2026-11-22',
    segment: 'women',
    sponsored: false,
    sponsorName: null,
    looks: [
      {
        id: 'edit-2026-w47-d6',
        day: 6,
        title: 'Hafta sonu',
        styleNote: null,
        imageUrl: null,
        variants: [{ priceBand: 'luxuryTouch', products: [product('lx-dress', 'onePiece', 'dress'), product('lx-skirt', 'bottom', 'skirt'), product('lx-bag', 'bag', 'bag')], totalMinor: 1, currency: 'TRY' }],
      },
      {
        id: 'edit-2026-w47-d1',
        day: 1,
        title: 'Ofis',
        styleNote: 'Net çizgiler.',
        imageUrl: 'https://cdn.example/d1.jpg',
        variants: [
          {
            priceBand: 'highStreet',
            products: [product('hs-shirt', 'top', 'shirt'), product('hs-jeans', 'bottom', 'jeans'), product('hs-gone', 'shoes', 'shoes', { available: false }), product('hs-belt', 'accessory', 'accessory'), product('hs-bag', 'bag', 'bag')],
            totalMinor: 400000,
            currency: 'TRY',
          },
        ],
      },
    ],
  };

  it('maps the weekly edit: days from weekStart, price bands, per-user flags', () => {
    const mapped = toWeeklyEdit(edit, {
      ownedByProduct: new Map([['hs-shirt', 'item-9']]),
      watchedProductIds: new Set(['hs-jeans']),
      savedLookNames: new Set(['Ofis']),
      hasBodyPhoto: true,
    });
    expect(mapped).toMatchObject({ id: 'edit-2026-w47', weekStart: '2026-11-16', weekEnd: '2026-11-22', hasBodyPhoto: true });
    expect(mapped.looks.map((l) => [l.id, l.date, l.occasion, l.isSaved])).toEqual([
      ['edit-2026-w47-d1', '2026-11-16', 'office', true],
      ['edit-2026-w47-d6', '2026-11-21', 'weekend', false],
    ]);
    const monday = mapped.looks[0];
    expect(monday?.products.luxury_touch).toEqual([]);
    // Retired products are not offered.
    expect(monday?.products.high_street.map((p) => p.id)).toEqual(['hs-shirt', 'hs-jeans', 'hs-belt', 'hs-bag']);
    expect(monday?.products.high_street[0]).toEqual({
      id: 'hs-shirt',
      brand: 'Gap',
      name: 'Ürün hs-shirt',
      price: { amountMinor: 100000, currency: 'TRY' },
      imageUrl: 'https://cdn.example/hs-shirt.jpg',
      category: 'top',
      ownedItemId: 'item-9',
      inWatchlist: false,
    });
    expect(monday?.products.high_street[1]).toMatchObject({ category: 'bottom', inWatchlist: true, ownedItemId: null });
    expect(toWeeklyEditCards(edit)[0]).toEqual({ id: 'edit-2026-w47-d1', date: '2026-11-16', name: 'Ofis', imageUrl: 'https://cdn.example/d1.jpg' });
  });

  it('builds look slots from an edit look: one product per slot, bag/accessory share one, a one-piece closes bottom', () => {
    const [weekend, monday] = edit.looks;
    expect(monday && editLookSlots(monday, 'highStreet')).toEqual([
      { slot: 'top', productId: 'hs-shirt' },
      { slot: 'bottom', productId: 'hs-jeans' },
      { slot: 'bagAccessory', productId: 'hs-belt' },
    ]);
    // Asked band missing → the look's only variant.
    expect(weekend && editLookSlots(weekend, 'highStreet')).toEqual([
      { slot: 'top', productId: 'lx-dress' },
      { slot: 'bagAccessory', productId: 'lx-bag' },
    ]);
  });

  it('adds calendar days without time-zone drift', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
  });
});
