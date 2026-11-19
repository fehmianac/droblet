/**
 * E5 Bavullar — the app-side shapes. Wire shapes (docs/api/wardrobe-looks-plan-stylist.md §6:
 * `TripDto`, `TripDetailDto`, `PackResult`) and the mapping live in `../wire/trips`.
 * Calendar dates are `YYYY-MM-DD`; wire times are UTC ISO-8601.
 */
import type { JobAccepted } from './jobs';
import type { ItemCategory, ItemColor, LookRef } from './wardrobe';

/** The wire `TripType` enum. (Beach / ski trips have no server value yet, so the form does not offer them.) */
export const TRIP_TYPES = ['business', 'dinner', 'sightseeing'] as const;
export type TripType = (typeof TRIP_TYPES)[number];

/** Longest trip the server accepts (400 `date_range_invalid` above it). */
export const TRIP_MAX_DAYS = 21;

/** GET v1/weather/city?q= (2–60 chars) → up to 8 cities, names in the request language. 503 `weather_unavailable`. */
export type City = {
  id: string;
  /** Localised city name, e.g. "Londra". */
  name: string;
  /** Country / region line under the name, e.g. "Birleşik Krallık" (wire `region` + `country`). */
  region: string;
};

/** The four glyphs of the forecast strip; the wire's 10 conditions are folded into them. */
export type WeatherCondition = 'sun' | 'cloud' | 'rain' | 'snow';

export type ForecastDay = { date: string; temperatureC: number; condition: WeatherCondition };

/**
 * Wire `TripDetailDto.forecast.status`: `available` (every day) · `partial` (the first days; the rest is past the
 * provider's 16-day horizon) · `beyondRange` (the trip starts after the horizon — "not available yet") · `past` ·
 * `unavailable` (provider down) · `noLocation` (the city could not be resolved).
 */
export const FORECAST_STATUSES = ['available', 'partial', 'beyondRange', 'past', 'unavailable', 'noLocation'] as const;
export type ForecastStatus = (typeof FORECAST_STATUSES)[number];

/** GET v1/tenant/trip → `Trip[]` (upcoming and past; the device splits them by `endDate`). */
export type Trip = {
  /** ULID from the device. */
  id: string;
  cityId: string;
  cityName: string;
  /** Not on the wire trip (only the city search has it); empty unless known from the form. */
  region: string;
  startDate: string;
  endDate: string;
  tripTypes: TripType[];
  /** "Tek kabin bavulu": the list is limited to a cabin bag. */
  cabinOnly: boolean;
  /** 'new' = no accepted list yet; 'packed' = the user accepted a list (wire `itemCount > 0`). */
  status: 'new' | 'packed';
  /** Wire `status`: where the trip is in time. */
  timeStatus?: 'upcoming' | 'active' | 'past';
  /** Archived by the user or already over. */
  archived?: boolean;
  /**
   * A running / finished-but-unaccepted pack job, so a reopened screen resumes it instead of starting
   * another. Kept on the device (persisted query cache) — the server does not list a trip's jobs.
   */
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

/**
 * A trip day. The wire day is `{ date, label, occasion, slots, weather }` — not a saved look: `look`
 * is a reference built from it (`id` = `{tripId}:{date}`, name = the day label, image = first piece).
 */
export type TripDay = { date: string; look: LookRef | null; itemIds?: string[] };

export type TripMissingPiece = {
  id: string;
  /** e.g. "Yağmur botu". */
  name: string;
  /** Localised in the app from the wire `MissingPieceReason` (`emptySlot | rain | cold | noShoes | suggested`). */
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
  /** "Her parça en az N kez giyiliyor": 2 when the wire says `everyPieceWornTwice`, else null. */
  minWearsPerItem: number | null;
};

/** GET v1/tenant/trip/{id} */
export type TripDetail = Trip &
  TripPlan & {
    /** Daily forecast for the trip dates; null when nothing is known (see `forecastStatus` for why). */
    forecast: ForecastDay[] | null;
    /** Why the forecast is what it is; absent on an optimistic (not yet confirmed) trip or an older server. */
    forecastStatus?: ForecastStatus;
  };

export type TripFields = Pick<Trip, 'cityId' | 'startDate' | 'endDate' | 'tripTypes' | 'cabinOnly'>;

/** POST v1/tenant/trip `{ id, cityId, cityName, startDate, endDate, tripTypes, cabinOnly }` → 201 (200 for the same id again). */
export type CreateTripRequest = TripFields & { id: string; clientMutationId: string };

/** PUT v1/tenant/trip/{id} — same fields + `baseVersion`; 409 answers the current wire trip. */
export type PutTripRequest = TripFields & { baseVersion: number; clientMutationId: string };

/** DELETE v1/tenant/trip/{id} — no body. */

/**
 * POST v1/tenant/trip/{id}/pack → 202 job (`stylistPack`; 403 `premium_required`). Its `PackResult` maps to a draft `TripPlan`.
 * `requestId` must be a ULID (400 `request_id_invalid` otherwise): the first attempt uses the trip id itself.
 */
export type PackTripRequest = { requestId: string };
export type PackTripResponse = JobAccepted;

/** POST v1/tenant/trip/{id}/pack/{jobId}/accept → trip detail. 409 `job_not_completed` / `suggestion_stale`. */
export type AcceptPackRequest = { clientMutationId: string };

/** PUT v1/tenant/trip/{id}/item/{itemId} — packing tick; idempotent, a late older event never overrides a newer one. */
export type CheckTripItemRequest = { packed: boolean; clientMutationId: string; occurredAt: string };
