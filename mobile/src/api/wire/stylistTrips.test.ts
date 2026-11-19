import type { Item } from '@/api/contracts/wardrobe';
import i18n from '@/i18n';

import type { ProductWire } from './catalog';
import { fromAcceptSuggestion, fromDislikeReasons, fromStylistRequest, toAcceptedSuggestion, toStylistResult, type OutfitResultWire } from './stylist';
import { mergeTrip, toMissingPiece, toTrip, toTripDetail, toTripForecast, toTripPlan, type PackResultWire, type TripDetailWire, type TripWire } from './trips';
import { cachedTryOnImageId, cachedTryOnJobId, toTryOnResult, toWeekJobs, toWeekQuote, toWireTarget } from './tryon';
import { toCity, toForecast, toWeatherGlyph } from './weather';

jest.mock('../config', () => ({ apiBaseUrl: () => 'https://api.example.test' }));

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});

function item(id: string, name: string, category: Item['category']): Item {
  return {
    id,
    name,
    category,
    subcategory: null,
    brand: null,
    size: null,
    color: 'navy',
    fabric: null,
    seasons: ['autumn'],
    imageUrl: `https://img.test/${id}.png`,
    originalImageUrl: null,
    useOriginalImage: false,
    wearCount: 0,
    lastWornAt: null,
    createdAt: '2026-11-18T09:00:00Z',
    baseVersion: 1,
  };
}

const items = new Map<string, Item>([
  ['I1', item('I1', 'Lacivert blazer', 'outerwear')],
  ['I2', item('I2', 'Beyaz gömlek', 'top')],
]);

const product: ProductWire = {
  id: 'prd-bag',
  brandId: 'gap',
  brandName: 'Gap',
  name: 'Deri çanta',
  description: null,
  category: 'bag',
  slot: 'bag',
  colors: ['black'],
  sizes: [],
  priceMinor: 250000,
  currency: 'TRY',
  previousPriceMinor: null,
  priceBand: 'highStreet',
  images: ['https://cdn.test/bag.jpg'],
  available: true,
  createdAt: '2026-11-18T09:00:00Z',
};

describe('stylist wire mapping', () => {
  it('sends the real outfit request fields', () => {
    expect(
      fromStylistRequest({ requestId: 'R1', date: '2026-11-18', occasion: 'evening', text: 'iş yemeği', cityId: null, wardrobeOnly: true, itemIds: ['I1', 'I2'] }),
    ).toEqual({
      requestId: 'R1',
      date: '2026-11-18',
      occasion: 'dinner',
      freeText: 'iş yemeği',
      onlyMyWardrobe: true,
      pinnedItemId: 'I1',
      cityId: null,
      latitude: null,
      longitude: null,
    });
  });

  it('joins a wire result with the wardrobe and the catalogue', () => {
    const wire: OutfitResultWire = {
      date: '2026-11-18',
      occasion: 'dinner',
      onlyMyWardrobe: false,
      refusal: null,
      language: 'tr',
      suggestions: [
        {
          index: 0,
          title: 'Gece Laciverti',
          explanation: 'Lacivert üst, açık alt.',
          source: 'model',
          slots: [
            { slot: 'outerwear', itemId: 'I1', productId: null },
            { slot: 'top', itemId: 'GONE', productId: null },
          ],
          missing: [
            { slot: 'bagAccessory', category: 'bag', reason: 'suggested', productId: 'prd-bag' },
            { slot: 'shoes', category: 'shoes', reason: 'noShoes', productId: null },
          ],
        },
        { index: 1, title: null, explanation: null, source: 'rule', slots: [{ slot: 'top', itemId: 'I2', productId: null }], missing: [] },
      ],
    };
    const result = toStylistResult(wire, { items, products: new Map([[product.id, product]]) }, null, { text: 'iş yemeği' });
    expect(result.request).toEqual({ date: '2026-11-18', occasion: 'dinner', text: 'iş yemeği', wardrobeOnly: false });
    expect(result.refusal).toBeNull();
    const [first, second] = result.suggestions;
    expect(first?.name).toBe('Gece Laciverti');
    expect(first?.pieces.map((p) => [p.slot, p.source, p.refId])).toEqual([
      ['outerwear', 'wardrobe', 'I1'],
      ['accessory', 'store', 'prd-bag'],
    ]);
    expect(first?.pieces[1]?.price).toEqual({ amountMinor: 250000, currency: 'TRY' });
    expect(first?.pieces[1]?.category).toBe('bag');
    // The rule-based fallback has no AI text: the app's own neutral wording.
    expect(second?.name).toBe('Öneri 2');
    expect(second?.note.length).toBeGreaterThan(0);
  });

  it('keeps what the user did with a suggestion and maps a refusal', () => {
    const wire: OutfitResultWire = { date: '2026-11-18', occasion: null, onlyMyWardrobe: true, refusal: 'insufficient_wardrobe', language: 'tr', suggestions: [] };
    expect(toStylistResult(wire, { items, products: new Map() }).refusal).toBe('insufficient_wardrobe');

    const again = toStylistResult(
      { ...wire, refusal: null, suggestions: [{ index: 0, title: 'A', explanation: 'B', source: 'model', slots: [], missing: [] }] },
      { items, products: new Map() },
      {
        request: { date: '2026-11-18', occasion: null, text: 'x', wardrobeOnly: true },
        weather: null,
        suggestions: [{ index: 0, name: 'A', note: 'B', pieces: [], tryOnImageUrl: null, savedLookId: 'L1', plannedDate: '2026-11-19' }],
      },
    );
    expect(again.suggestions[0]).toMatchObject({ savedLookId: 'L1', plannedDate: '2026-11-19' });
    expect(again.request.text).toBe('x');
  });

  it('maps accept and dislike', () => {
    expect(fromAcceptSuggestion({ lookId: 'L1', date: '2026-11-18', clientMutationId: 'C1', occurredAt: 'now' })).toEqual({
      clientMutationId: 'C1',
      lookId: 'L1',
      name: null,
      planDate: '2026-11-18',
      favorite: false,
    });
    expect(toAcceptedSuggestion({ look: { id: 'L1' } as never, planDay: { date: '2026-11-18', lookId: 'L1' } })).toEqual({ lookId: 'L1', plannedDate: '2026-11-18' });
    expect(toAcceptedSuggestion({ look: { id: 'L1' } as never, planDay: null })).toEqual({ lookId: 'L1', plannedDate: null });
    expect(fromDislikeReasons(['colors', 'weather'])).toBe('colorMismatch');
    expect(fromDislikeReasons(['too_formal'])).toBe('notMyStyle');
    expect(fromDislikeReasons([])).toBe('other');
  });
});

const tripWire: TripWire = {
  id: 'T1',
  cityId: 'paris',
  cityName: 'Paris',
  startDate: '2027-03-01',
  endDate: '2027-03-03',
  tripTypes: ['business', 'dinner'],
  cabinOnly: true,
  status: 'upcoming',
  archived: false,
  archivedAt: null,
  dayCount: 3,
  itemCount: 2,
  packedCount: 1,
  everyPieceWornTwice: true,
  missing: [{ slot: 'outerwear', category: 'outerwear', reason: 'rain', productId: null }],
  createdAt: '2026-11-18T09:00:00Z',
  updatedAt: '2026-11-18T09:00:00Z',
  version: 2,
};

describe('trip wire mapping', () => {
  it('maps the list row; a trip without pieces is "new" and keeps its pack job', () => {
    expect(toTrip(tripWire, { region: 'Fransa', packJobId: 'J1' })).toMatchObject({
      id: 'T1',
      cityName: 'Paris',
      region: 'Fransa',
      status: 'packed',
      packJobId: null,
      itemCount: 2,
      packedCount: 1,
      lookCount: 3,
      baseVersion: 2,
      timeStatus: 'upcoming',
      archived: false,
    });
    expect(toTrip({ ...tripWire, itemCount: 0, packedCount: 0 }, { packJobId: 'J1' })).toMatchObject({ status: 'new', packJobId: 'J1', lookCount: 0, region: '' });
  });

  it('joins the detail with the wardrobe', () => {
    const wire: TripDetailWire = {
      trip: tripWire,
      items: [
        { itemId: 'I1', plannedWears: 2, packed: true, packedAt: '2026-11-18T09:00:00Z', unavailable: false },
        { itemId: 'I2', plannedWears: 2, packed: false, packedAt: null, unavailable: false },
        { itemId: 'GONE', plannedWears: 2, packed: false, packedAt: null, unavailable: true },
      ],
      days: [
        {
          date: '2027-03-01',
          label: 'Uçuş + akşam yemeği',
          occasion: 'dinner',
          slots: [{ slot: 'top', itemId: 'I2', productId: null }],
          weather: { date: '2027-03-01', minTempC: 8, maxTempC: 14, condition: 'showers', precipitationChance: 70 },
        },
        { date: '2027-03-02', label: null, occasion: null, slots: [], weather: null },
      ],
    };
    const detail = toTripDetail(wire, items, { region: 'Fransa' });
    expect(detail.items.map((i) => [i.itemId, i.name, i.packed])).toEqual([
      ['I1', 'Lacivert blazer', true],
      ['I2', 'Beyaz gömlek', false],
    ]);
    expect(detail.days[0]).toEqual({
      date: '2027-03-01',
      itemIds: ['I2'],
      look: { id: 'T1:2027-03-01', name: 'Uçuş + akşam yemeği', occasion: 'dinner', imageUrl: 'https://img.test/I2.png' },
    });
    expect(detail.days[1]?.look).toBeNull();
    expect(detail.lookCount).toBe(1);
    expect(detail.minWearsPerItem).toBe(2);
    expect(detail.forecast).toEqual([{ date: '2027-03-01', temperatureC: 14, condition: 'rain' }]);
    expect(detail.missing[0]).toMatchObject({ category: 'outerwear', productId: null });
    expect(detail.missing[0]?.name.length).toBeGreaterThan(0);
    expect(detail.missing[0]?.reason).toBe('yağmur bekleniyor');
  });

  it('takes the forecast strip from the detail forecast block, also before anything is packed', () => {
    // The reported case: London 25–29 Nov, nothing packed (no plan days), the server knows every day.
    const weather = (date: string, max: number) => ({ date, minTempC: 4, maxTempC: max, condition: 'cloudy' as const, precipitationChance: 20 });
    const fromBlock = toTripForecast({
      days: [],
      forecast: { status: 'available', days: [weather('2026-11-25', 9), weather('2026-11-26', 10)], horizonEnd: '2026-12-04' },
    });
    expect(fromBlock).toEqual({
      forecast: [
        { date: '2026-11-25', temperatureC: 9, condition: 'cloud' },
        { date: '2026-11-26', temperatureC: 10, condition: 'cloud' },
      ],
      forecastStatus: 'available',
    });
    expect(toTripForecast({ days: [], forecast: { status: 'beyondRange', days: [], horizonEnd: '2026-12-04' } })).toEqual({ forecast: null, forecastStatus: 'beyondRange' });
    // An unknown status from a newer server reads as "couldn't be loaded"; an older server without the block keeps the plan days' weather.
    expect(toTripForecast({ days: [], forecast: { status: 'somethingNew' as never, days: [], horizonEnd: null } }).forecastStatus).toBe('unavailable');
    expect(toTripForecast({ days: [{ date: '2026-11-25', label: null, occasion: null, slots: [], weather: weather('2026-11-25', 9) }] })).toEqual({
      forecast: [{ date: '2026-11-25', temperatureC: 9, condition: 'cloud' }],
    });
  });

  it('merges a write answer (wire trip only) into the cached detail', () => {
    const base = toTripDetail({ trip: tripWire, items: [{ itemId: 'I1', plannedWears: 1, packed: false, packedAt: null, unavailable: false }], days: [] }, items, { region: 'Fransa' });
    const merged = mergeTrip({ ...tripWire, cabinOnly: false, version: 3 }, base);
    expect(merged).toMatchObject({ cabinOnly: false, baseVersion: 3, region: 'Fransa' });
    expect(merged.items).toHaveLength(1);
  });

  it('maps a pack result to a draft plan', () => {
    const wire: PackResultWire = {
      tripId: 'T1',
      cabinOnly: true,
      everyPieceWornTwice: false,
      source: 'model',
      refusal: null,
      language: 'tr',
      items: [{ itemId: 'I1', plannedWears: 2 }],
      days: [{ date: '2027-03-01', label: 'Gün 1', occasion: 'office', slots: [{ slot: 'outerwear', itemId: 'I1', productId: null }] }],
      missing: [],
      cabinLimit: 12,
      cabinTrimmed: false,
      droppedItemIds: [],
    };
    const plan = toTripPlan(wire, items);
    expect(plan.items).toEqual([{ itemId: 'I1', name: 'Lacivert blazer', category: 'outerwear', color: 'navy', imageUrl: 'https://img.test/I1.png', packed: false }]);
    expect(plan.days[0]?.look?.name).toBe('Gün 1');
    expect(plan.minWearsPerItem).toBeNull();
  });

  it('gives a missing piece without a category the slot name', () => {
    expect(toMissingPiece({ slot: 'bagAccessory', category: null, reason: 'suggested', productId: 'p' }, 0)).toMatchObject({ category: 'accessory', productId: 'p' });
  });
});

describe('try-on wire mapping', () => {
  it('maps app targets to wire targets', async () => {
    await expect(toWireTarget({ kind: 'look', id: 'L1' })).resolves.toEqual({ kind: 'look', id: 'L1', index: null });
    await expect(toWireTarget({ kind: 'edit-look', id: 'edit-1-d1@luxuryTouch' })).resolves.toEqual({ kind: 'editLook', id: 'edit-1-d1@luxuryTouch', index: null });
    await expect(toWireTarget({ kind: 'suggestion', id: '01JOB:2' })).resolves.toEqual({ kind: 'suggestion', id: '01JOB', index: 2 });
    await expect(toWireTarget({ kind: 'suggestion', id: 'nojob' })).rejects.toMatchObject({ code: 'target_index_invalid' });
    await expect(toWireTarget({ kind: 'trip-day', id: 'T1:2027-03-01' })).resolves.toEqual({ kind: 'tripDay', id: 'T1/2027-03-01', index: null });
    await expect(toWireTarget({ kind: 'trip-day', id: 'T1' })).rejects.toMatchObject({ code: 'target_id_invalid' });
  });

  it('maps the week quote and the batch (cached days get a pseudo job id)', () => {
    expect(
      toWeekQuote({
        weekStart: '2026-11-16',
        requiredCredits: 1,
        cachedCount: 1,
        remainingCredits: 12,
        sufficient: true,
        items: [
          { date: '2026-11-16', lookId: 'L1', cached: false, tryOnImageId: null },
          { date: '2026-11-17', lookId: 'L2', cached: true, tryOnImageId: 'IMG2' },
        ],
      }),
    ).toEqual({ weekStart: '2026-11-16', requiredCredits: 1, cachedCount: 1, dates: ['2026-11-16', '2026-11-17'] });
    expect(
      toWeekJobs({
        chargedCredits: 1,
        items: [
          { date: '2026-11-16', lookId: 'L1', status: 'queued', image: null, job: { id: 'J1' } as never },
          { date: '2026-11-17', lookId: 'L2', status: 'cached', image: { id: 'IMG2', url: 'u', urlExpiresAt: 'x', createdAt: 'y' }, job: null },
        ],
      }),
    ).toEqual({ '2026-11-16': 'J1', '2026-11-17': cachedTryOnJobId('IMG2') });
  });

  it('a cached image travels as a pseudo job id', () => {
    expect(cachedTryOnImageId(cachedTryOnJobId('IMG1'))).toBe('IMG1');
    expect(cachedTryOnImageId('01REALJOB')).toBeNull();
    expect(cachedTryOnImageId(null)).toBeNull();
    expect(toTryOnResult({ id: 'IMG1', url: 'https://s3/x', urlExpiresAt: 'x', createdAt: 'y' }, { kind: 'look', id: 'L1' })).toEqual({
      tryOnId: 'IMG1',
      target: { kind: 'look', id: 'L1' },
      imageUrl: 'https://s3/x',
      creditsRemaining: null,
    });
  });
});

describe('weather wire mapping', () => {
  it('maps a city and a forecast', () => {
    const city = { id: '745044', name: 'İstanbul', region: 'İstanbul', country: 'Türkiye', countryCode: 'TR', latitude: 41, longitude: 28.9, timeZone: 'Europe/Istanbul' };
    expect(toCity(city)).toEqual({ id: '745044', name: 'İstanbul', region: 'Türkiye' });
    expect(toCity({ ...city, name: 'Bodrum', region: 'Muğla' })).toEqual({ id: '745044', name: 'Bodrum', region: 'Muğla, Türkiye' });
    expect(
      toForecast({
        locationKey: 'city:745044',
        city,
        fetchedAt: 'x',
        days: [{ date: '2026-11-18', minC: 8, maxC: 15.3, condition: 'rain', weatherCode: 61, precipitationProbability: 70 }],
      }),
    ).toEqual({ city: 'İstanbul', days: [{ date: '2026-11-18', temperatureC: 15, summary: 'yağmurlu' }] });
    expect(toWeatherGlyph('thunderstorm')).toBe('rain');
    expect(toWeatherGlyph('clear')).toBe('sun');
    expect(toWeatherGlyph(null)).toBe('cloud');
  });
});
