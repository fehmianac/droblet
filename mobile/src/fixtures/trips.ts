import type {
  CheckTripItemRequest,
  CreateTripRequest,
  ForecastDay,
  PackTripRequest,
  PackTripResponse,
  PutTripRequest,
  Trip,
  TripDetail,
  TripItem,
  TripPlan,
  WeatherCondition,
} from '@/api/contracts/trips';
import { ApiError } from '@/api/errors';
import { addDays, searchCities, tripDates, type SearchableCity } from '@/features/trips/logic';
import { toIsoDate } from '@/lib/format';

import { clone, fixtureDb, onFixtureSeed } from './db';
import { startFixtureJob } from './jobs';

/**
 * Fixture "server" for trips (E5): city directory, forecast, trip CRUD, the packing job and check
 * marks. Sample data from the `Bavul` / `BavulDetay` boards. Nothing survives a restart.
 */
export const fixtureCities: SearchableCity[] = [
  { id: 'city_istanbul', name: 'İstanbul', region: 'Türkiye' },
  { id: 'city_izmir', name: 'İzmir', region: 'Türkiye' },
  { id: 'city_ankara', name: 'Ankara', region: 'Türkiye' },
  { id: 'city_antalya', name: 'Antalya', region: 'Türkiye' },
  { id: 'city_bodrum', name: 'Bodrum', region: 'Muğla, Türkiye' },
  { id: 'city_london', name: 'Londra', region: 'Birleşik Krallık', aliases: ['London'] },
  { id: 'city_london_on', name: 'London', region: 'Ontario, Kanada' },
  { id: 'city_paris', name: 'Paris', region: 'Fransa' },
  { id: 'city_rome', name: 'Roma', region: 'İtalya', aliases: ['Rome'] },
  { id: 'city_milan', name: 'Milano', region: 'İtalya', aliases: ['Milan'] },
  { id: 'city_berlin', name: 'Berlin', region: 'Almanya' },
  { id: 'city_amsterdam', name: 'Amsterdam', region: 'Hollanda' },
  { id: 'city_barcelona', name: 'Barselona', region: 'İspanya', aliases: ['Barcelona'] },
  { id: 'city_vienna', name: 'Viyana', region: 'Avusturya', aliases: ['Vienna', 'Wien'] },
  { id: 'city_athens', name: 'Atina', region: 'Yunanistan', aliases: ['Athens'] },
  { id: 'city_new_york', name: 'New York', region: 'ABD' },
  { id: 'city_dubai', name: 'Dubai', region: 'Birleşik Arap Emirlikleri' },
  { id: 'city_tokyo', name: 'Tokyo', region: 'Japonya' },
];

export function fixtureSearchCities(query: string) {
  return searchCities(fixtureCities, query).map(({ id, name, region }) => ({ id, name, region }));
}

type StoredTrip = TripDetail;

let trips: StoredTrip[] = [];

const CONDITIONS: WeatherCondition[] = ['rain', 'cloud', 'rain', 'cloud', 'rain', 'sun'];
const TEMPS = [9, 7, 8, 6, 8, 10];

function forecastFor(startDate: string, endDate: string): ForecastDay[] {
  return tripDates(startDate, endDate).map((date, i) => ({
    date,
    temperatureC: TEMPS[i % TEMPS.length] ?? 8,
    condition: CONDITIONS[i % CONDITIONS.length] ?? 'cloud',
  }));
}

const PACK_ORDER = [
  'item_navy_blazer',
  'item_black_midi',
  'item_white_shirt',
  'item_straight_jeans',
  'item_cream_knit',
  'item_black_trousers',
  'item_beige_trench',
  'item_black_boots',
  'item_black_bag',
  'item_croc_flats',
  'item_tweed_jacket',
];

function buildPlan(trip: Pick<Trip, 'startDate' | 'endDate' | 'cabinOnly'>, packedIds: string[] = []): TripPlan {
  const pool = [
    ...PACK_ORDER.flatMap((id) => fixtureDb.items.filter((i) => i.id === id)),
    ...fixtureDb.items.filter((i) => !PACK_ORDER.includes(i.id)),
  ];
  const limit = trip.cabinOnly ? 6 : 9;
  const items: TripItem[] = pool.slice(0, limit).map((i) => ({
    itemId: i.id,
    name: i.name,
    category: i.category,
    color: i.color,
    imageUrl: i.useOriginalImage ? i.originalImageUrl : i.imageUrl,
    packed: packedIds.includes(i.id),
  }));
  const looks = fixtureDb.looks;
  const dates = tripDates(trip.startDate, trip.endDate);
  const days = dates.map((date, i) => {
    const look = looks.length > 0 ? looks[i % looks.length] : undefined;
    return { date, look: look ? { id: look.id, name: look.name, occasion: look.occasion, imageUrl: look.tryOnImageUrl } : null };
  });
  const rainy = forecastFor(trip.startDate, trip.endDate).filter((d) => d.condition === 'rain').length;
  return {
    items,
    days,
    missing:
      rainy > 0 && items.length > 0
        ? [{ id: 'missing_rain_boots', name: 'Yağmur botu', reason: `${rainy} gün yağmur var`, category: 'shoes', productId: 'prod_rain_boots' }]
        : [],
    minWearsPerItem: items.length > 0 && dates.length >= 3 ? 2 : null,
  };
}

function withCounts(trip: StoredTrip): StoredTrip {
  return {
    ...trip,
    itemCount: trip.items.length,
    packedCount: trip.items.filter((i) => i.packed).length,
    lookCount: trip.days.filter((d) => d.look).length,
  };
}

function cityOf(cityId: string) {
  return fixtureCities.find((c) => c.id === cityId) ?? { id: cityId, name: cityId, region: '' };
}

function seedTrips(): StoredTrip[] {
  const today = toIsoDate(new Date());
  const upcoming = { startDate: addDays(today, 14), endDate: addDays(today, 18), cabinOnly: false };
  const past = { startDate: addDays(today, -40), endDate: addDays(today, -37), cabinOnly: true };
  const base = { tripTypes: ['business', 'dinner'] as Trip['tripTypes'], packJobId: null, createdAt: '2026-11-10T09:00:00.000Z', baseVersion: 1 };
  return [
    withCounts({
      id: 'trip_londra',
      cityId: 'city_london',
      cityName: 'Londra',
      region: 'Birleşik Krallık',
      ...upcoming,
      ...base,
      status: 'packed',
      itemCount: 0,
      packedCount: 0,
      lookCount: 0,
      ...buildPlan(upcoming, ['item_navy_blazer', 'item_black_midi', 'item_white_shirt']),
      forecast: forecastFor(upcoming.startDate, upcoming.endDate),
    }),
    withCounts({
      id: 'trip_paris',
      cityId: 'city_paris',
      cityName: 'Paris',
      region: 'Fransa',
      ...past,
      ...base,
      tripTypes: ['sightseeing'],
      status: 'packed',
      itemCount: 0,
      packedCount: 0,
      lookCount: 0,
      ...buildPlan(past, fixtureDb.items.map((i) => i.id)),
      forecast: null,
    }),
  ];
}

onFixtureSeed((_db, { empty }) => {
  trips = empty ? [] : seedTrips();
});

function summary(trip: StoredTrip): Trip {
  const { items: _items, days: _days, missing: _missing, minWearsPerItem: _min, forecast: _forecast, ...rest } = withCounts(trip);
  void _items;
  void _days;
  void _missing;
  void _min;
  void _forecast;
  return rest;
}

function find(id: string): StoredTrip {
  const trip = trips.find((t) => t.id === id);
  if (!trip) throw new ApiError('http', 404, null);
  return trip;
}

function replace(next: StoredTrip): StoredTrip {
  const counted = withCounts(next);
  trips = trips.map((t) => (t.id === counted.id ? counted : t));
  return counted;
}

export function fixtureListTrips(): Trip[] {
  return clone(trips.map(summary));
}

export function fixtureGetTrip(id: string): TripDetail {
  return clone(withCounts(find(id)));
}

export function fixtureCreateTrip(request: CreateTripRequest): TripDetail {
  const existing = trips.find((t) => t.id === request.id);
  if (existing) return clone(existing);
  const city = cityOf(request.cityId);
  const trip: StoredTrip = {
    id: request.id,
    cityId: request.cityId,
    cityName: city.name,
    region: city.region,
    startDate: request.startDate,
    endDate: request.endDate,
    tripTypes: request.tripTypes,
    cabinOnly: request.cabinOnly,
    status: 'new',
    packJobId: null,
    itemCount: 0,
    packedCount: 0,
    lookCount: 0,
    createdAt: new Date().toISOString(),
    baseVersion: 1,
    items: [],
    days: [],
    missing: [],
    minWearsPerItem: null,
    forecast: forecastFor(request.startDate, request.endDate),
  };
  trips = [trip, ...trips];
  return clone(trip);
}

export function fixturePutTrip(id: string, request: PutTripRequest): TripDetail {
  const current = find(id);
  if (current.baseVersion !== request.baseVersion) throw new ApiError('http', 409, { current: clone(summary(current)) });
  const city = cityOf(request.cityId);
  const datesChanged = current.startDate !== request.startDate || current.endDate !== request.endDate || current.cityId !== request.cityId;
  const next: StoredTrip = {
    ...current,
    cityId: request.cityId,
    cityName: city.name,
    region: city.region,
    startDate: request.startDate,
    endDate: request.endDate,
    tripTypes: request.tripTypes,
    cabinOnly: request.cabinOnly,
    baseVersion: current.baseVersion + 1,
    forecast: datesChanged ? forecastFor(request.startDate, request.endDate) : current.forecast,
  };
  // The server re-plans an accepted list when the cabin-only mode or the dates change.
  if (current.status === 'packed' && (datesChanged || current.cabinOnly !== request.cabinOnly)) {
    Object.assign(next, buildPlan(next, current.items.filter((i) => i.packed).map((i) => i.itemId)));
  }
  return clone(replace(next));
}

export function fixtureDeleteTrip(id: string): void {
  trips = trips.filter((t) => t.id !== id);
}

export function fixtureStartPack(id: string, request: PackTripRequest): PackTripResponse {
  const trip = find(id);
  const jobId = startFixtureJob<TripPlan>('trip-pack', () => buildPlan(find(id)), { id: `job_${request.requestId}` });
  replace({ ...trip, packJobId: jobId });
  return { jobId };
}

export function fixtureAcceptPack(id: string): TripDetail {
  const trip = find(id);
  if (trip.status === 'packed') return clone(trip);
  return clone(replace({ ...trip, ...buildPlan(trip), status: 'packed', packJobId: null }));
}

export function fixtureCheckTripItem(id: string, itemId: string, request: CheckTripItemRequest): void {
  const trip = find(id);
  replace({ ...trip, items: trip.items.map((i) => (i.itemId === itemId ? { ...i, packed: request.packed } : i)) });
}
