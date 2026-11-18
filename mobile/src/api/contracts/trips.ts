/**
 * E5 Bavullar — PROVISIONAL contract (BACKEND_ENGINEER §Uç nokta haritası, E5).
 * Calendar dates are `YYYY-MM-DD`; wire times are UTC ISO-8601.
 */
import type { JobAccepted } from './jobs';
import type { ItemCategory, ItemColor, LookRef } from './wardrobe';

export const TRIP_TYPES = ['business', 'dinner', 'sightseeing', 'beach', 'ski'] as const;
export type TripType = (typeof TRIP_TYPES)[number];

/** Longest trip the planner accepts (18). */
export const TRIP_MAX_DAYS = 30;

/**
 * Candidate: GET v1/weather/city?q= → `City[]` (prefix search, max ~8). Not in the endpoint map yet —
 * the map only has `GET v1/weather?cityId=&from=&to=`; the city directory needs an endpoint.
 */
export type City = {
  id: string;
  /** Localised city name, e.g. "Londra". */
  name: string;
  /** Country / region line under the name, e.g. "Birleşik Krallık". */
  region: string;
};

export type WeatherCondition = 'sun' | 'cloud' | 'rain' | 'snow';

export type ForecastDay = { date: string; temperatureC: number; condition: WeatherCondition };

/** GET v1/tenant/trip → `Trip[]` (upcoming and past; the device splits them by `endDate`). */
export type Trip = {
  /** ULID from the device. */
  id: string;
  cityId: string;
  cityName: string;
  region: string;
  startDate: string;
  endDate: string;
  tripTypes: TripType[];
  /** "Tek kabin bavulu": the list is limited to a cabin bag. */
  cabinOnly: boolean;
  /** 'new' = no accepted list yet; 'packed' = the user accepted a list. */
  status: 'new' | 'packed';
  /** A running / finished-but-unaccepted pack job, so a restarted app resumes it instead of starting another. */
  packJobId: string | null;
  itemCount: number;
  packedCount: number;
  lookCount: number;
  createdAt: string;
  baseVersion: number;
};

export type TripItem = {
  /** Wardrobe item id. */
  itemId: string;
  name: string;
  category: ItemCategory;
  color: ItemColor;
  imageUrl: string | null;
  packed: boolean;
};

export type TripDay = { date: string; look: LookRef | null };

export type TripMissingPiece = {
  id: string;
  /** e.g. "Yağmur botu". */
  name: string;
  /** Server-written, localised reason, e.g. "3 gün yağmur var". */
  reason: string;
  /** Category of the missing piece (placeholder glyph, shop filter); null when unknown. */
  category: ItemCategory | null;
  /** Catalogue product suggested for it, when any. */
  productId: string | null;
};

/** The generated content of a suitcase: job result of `trip-pack` (a draft) and part of `TripDetail` once accepted. */
export type TripPlan = {
  items: TripItem[];
  days: TripDay[];
  missing: TripMissingPiece[];
  /** "Her parça en az N kez giyiliyor"; null when the planner gives no such guarantee. */
  minWearsPerItem: number | null;
};

/** GET v1/tenant/trip/{id} */
export type TripDetail = Trip &
  TripPlan & {
    /** Daily forecast for the trip dates; null when the weather could not be fetched. */
    forecast: ForecastDay[] | null;
  };

export type TripFields = Pick<Trip, 'cityId' | 'startDate' | 'endDate' | 'tripTypes' | 'cabinOnly'>;

/** POST v1/tenant/trip — idempotent on `id` + `clientMutationId`. */
export type CreateTripRequest = TripFields & { id: string; clientMutationId: string };

/** PUT v1/tenant/trip/{id} — versioned (409 + `current` on conflict). */
export type PutTripRequest = TripFields & { baseVersion: number; clientMutationId: string };

/** DELETE v1/tenant/trip/{id} — no body. */

/** POST v1/tenant/trip/{id}/pack → 202. Result of the `trip-pack` job: `TripPlan` (a draft, nothing is saved). */
export type PackTripRequest = { requestId: string };
export type PackTripResponse = JobAccepted;

/** POST v1/tenant/trip/{id}/pack/{jobId}/accept → `TripDetail` (the draft becomes TripItem + TripDay). */
export type AcceptPackRequest = { clientMutationId: string };

/** PUT v1/tenant/trip/{id}/item/{itemId} — packing check mark (event-like; last write wins). */
export type CheckTripItemRequest = { packed: boolean; clientMutationId: string; occurredAt: string };
