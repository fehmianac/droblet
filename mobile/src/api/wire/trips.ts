/**
 * Wire shapes of the trip endpoints (docs/api/wardrobe-looks-plan-stylist.md §6: `TripDto`,
 * `TripDetailDto`, `PackResult`) and the mapping to the app's `Trip` / `TripDetail` / `TripPlan`.
 * The wire lists item ids; names, categories and images come from the user's wardrobe cache.
 */
import i18n from "@/i18n";
import { imageVariantsOf } from "@/lib/images";

import {
  FORECAST_STATUSES,
  type ForecastDay,
  type ForecastStatus,
  type Trip,
  type TripDay,
  type TripDetail,
  type TripFields,
  type TripItem,
  type TripMissingPiece,
  type TripPlan,
  type TripType,
} from "../contracts/trips";
import type { Item } from "../contracts/wardrobe";
import type { MissingPieceWire } from "./stylist";
import {
  fetchItemMap,
  toOccasion,
  type LookSlotWire,
  type OccasionWire,
} from "./wardrobe";
import { toWeatherGlyph, type DayWeatherWire } from "./weather";

export type TripWire = {
  id: string;
  cityId: string;
  cityName: string | null;
  startDate: string;
  endDate: string;
  tripTypes: TripType[];
  cabinOnly: boolean;
  status: "upcoming" | "active" | "past";
  /** Archived by the user or already over. */
  archived: boolean;
  archivedAt: string | null;
  dayCount: number;
  itemCount: number;
  packedCount: number;
  everyPieceWornTwice: boolean;
  missing: MissingPieceWire[];
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type TripItemWire = {
  itemId: string;
  plannedWears: number;
  packed: boolean;
  packedAt: string | null;
  unavailable: boolean;
};
export type TripDayWire = {
  date: string;
  label: string | null;
  occasion: OccasionWire | null;
  slots: LookSlotWire[];
  weather: DayWeatherWire | null;
};
/** `TripDetailDto.forecast`: every trip day the provider knows, packed or not (absent on older servers). */
export type TripForecastWire = {
  status: ForecastStatus;
  days: DayWeatherWire[];
  horizonEnd: string | null;
};
export type TripDetailWire = {
  trip: TripWire;
  items: TripItemWire[];
  days: TripDayWire[];
  forecast?: TripForecastWire | null;
};

/** POST v1/tenant/trip (with `id`) · PUT v1/tenant/trip/{id} (with `baseVersion`). */
export type TripWriteWire = {
  id?: string;
  cityId: string;
  cityName: string;
  startDate: string;
  endDate: string;
  tripTypes: TripType[];
  cabinOnly: boolean;
  baseVersion?: number;
};

export function fromTripFields(
  fields: TripFields,
  cityName: string,
): Omit<TripWriteWire, "id" | "baseVersion"> {
  return {
    cityId: fields.cityId,
    cityName,
    startDate: fields.startDate,
    endDate: fields.endDate,
    tripTypes: fields.tripTypes,
    cabinOnly: fields.cabinOnly,
  };
}

/** Result of a `stylistPack` job — a draft until `pack/{jobId}/accept`. */
export type PackResultWire = {
  tripId: string;
  cabinOnly: boolean;
  everyPieceWornTwice: boolean;
  source: "model" | "rule";
  refusal: string | null;
  language: string;
  items: { itemId: string; plannedWears: number }[];
  days: Omit<TripDayWire, "weather">[];
  missing: MissingPieceWire[];
  cabinLimit: number | null;
  cabinTrimmed: boolean;
  droppedItemIds: string[];
  /** Some pieces were picked by Droblet (library / catalogue) to make the capsule possible. */
  gapFilled?: boolean;
};

/** What only the device knows about a trip (city region from the form, the running pack job). */
export type TripLocal = { region?: string; packJobId?: string | null };

export function toTrip(wire: TripWire, local: TripLocal = {}): Trip {
  const packed = wire.itemCount > 0;
  return {
    id: wire.id,
    cityId: wire.cityId,
    cityName: wire.cityName ?? "",
    region: local.region ?? "",
    startDate: wire.startDate,
    endDate: wire.endDate,
    tripTypes: wire.tripTypes,
    cabinOnly: wire.cabinOnly,
    status: packed ? "packed" : "new",
    timeStatus: wire.status,
    archived: wire.archived,
    // An accepted list ends the job that produced it.
    packJobId: packed ? null : (local.packJobId ?? null),
    itemCount: wire.itemCount,
    packedCount: wire.packedCount,
    // The list endpoint has no look count; a packed trip has one look per trip day.
    lookCount: packed ? wire.dayCount : 0,
    createdAt: wire.createdAt,
    baseVersion: wire.version,
  };
}

function toTripItem(
  wire: { itemId: string; packed?: boolean },
  items: Map<string, Item>,
): TripItem | null {
  const item = items.get(wire.itemId);
  // A piece deleted from the wardrobe (`unavailable`) can no longer be shown or packed.
  if (!item) return null;
  return {
    itemId: item.id,
    name: item.name,
    category: item.category,
    color: item.color,
    imageUrl: item.imageUrl,
    ...imageVariantsOf(item),
    packed: Boolean(wire.packed),
  };
}

function toTripDay(
  tripId: string,
  wire: Omit<TripDayWire, "weather">,
  items: Map<string, Item>,
): TripDay {
  const itemIds = wire.slots
    .map((s) => s.itemId)
    .filter((id): id is string => Boolean(id) && items.has(id as string));
  if (itemIds.length === 0) return { date: wire.date, look: null, itemIds: [] };
  const first = items.get(itemIds[0] as string);
  return {
    date: wire.date,
    itemIds,
    look: {
      id: `${tripId}:${wire.date}`,
      name: wire.label ?? "",
      occasion: toOccasion(wire.occasion) ?? "travel",
      // A 152 × 200 cover in the day sheet: the medium variant (older servers: the full image).
      imageUrl: first?.mediumUrl ?? first?.imageUrl ?? null,
    },
  };
}

export function toMissingPiece(
  wire: MissingPieceWire,
  index: number,
): TripMissingPiece {
  const category =
    wire.category ?? (wire.slot === "bagAccessory" ? "accessory" : wire.slot);
  return {
    id: `${wire.slot}-${wire.reason}-${index}`,
    name: i18n.t(`itemCategory.${category}`),
    reason: i18n.t(`tripDetail.missingReason.${wire.reason}`),
    category,
    productId: wire.productId,
    libraryItemId: wire.libraryItemId ?? null,
  };
}

const toForecastDay = (w: DayWeatherWire): ForecastDay => ({
  date: w.date,
  temperatureC: w.maxTempC,
  condition: toWeatherGlyph(w.condition),
  minC: w.minTempC,
  maxC: w.maxTempC,
  rainChance: w.precipitationChance ?? null,
});

/**
 * The forecast strip: the detail's `forecast` block (every trip day, also before anything is packed); an older
 * server without it only had weather on the accepted plan's days.
 */
export function toTripForecast(
  wire: Pick<TripDetailWire, "days" | "forecast">,
): { forecast: ForecastDay[] | null; forecastStatus?: ForecastStatus } {
  if (wire.forecast) {
    const days = (wire.forecast.days ?? []).map(toForecastDay);
    const status = (FORECAST_STATUSES as readonly string[]).includes(
      wire.forecast.status,
    )
      ? wire.forecast.status
      : "unavailable";
    return { forecast: days.length > 0 ? days : null, forecastStatus: status };
  }
  const days = wire.days
    .map((d) =>
      d.weather ? toForecastDay({ ...d.weather, date: d.date }) : null,
    )
    .filter((d): d is ForecastDay => d !== null);
  return { forecast: days.length > 0 ? days : null };
}

export function toTripDetail(
  wire: TripDetailWire,
  items: Map<string, Item>,
  local: TripLocal = {},
): TripDetail {
  const tripItems = wire.items
    .map((i) => toTripItem(i, items))
    .filter((i): i is TripItem => i !== null);
  const days = wire.days.map((d) => toTripDay(wire.trip.id, d, items));
  return {
    ...toTrip(wire.trip, local),
    items: tripItems,
    days,
    missing: (wire.trip.missing ?? []).map(toMissingPiece),
    // "Her parça en az 2 kez giyiliyor" is shown only when the server says so (never on a 1-day trip).
    minWearsPerItem: wire.trip.everyPieceWornTwice ? 2 : null,
    ...toTripForecast(wire),
    lookCount: days.filter((d) => d.look).length,
  };
}

export async function toTripDetailAsync(
  wire: TripDetailWire,
  local: TripLocal = {},
): Promise<TripDetail> {
  return toTripDetail(wire, await fetchItemMap(), local);
}

/** A write answers the wire trip only: the cached / optimistic detail keeps its list, days and forecast. */
export function mergeTrip(wire: TripWire, base: TripDetail): TripDetail {
  const trip = toTrip(wire, { region: base.region, packJobId: base.packJobId });
  return {
    ...base,
    ...trip,
    lookCount: base.days.filter((d) => d.look).length,
    missing: (wire.missing ?? []).map(toMissingPiece),
    minWearsPerItem: wire.everyPieceWornTwice ? 2 : null,
    gapFilled: (wire.missing ?? []).some((m) => Boolean(m.libraryItemId)),
  };
}

export class PackRefusedError extends Error {
  readonly refusal: string;
  constructor(refusal: string) {
    super(`pack refused: ${refusal}`);
    this.name = "PackRefusedError";
    this.refusal = refusal;
  }
}

export function toTripPlan(
  wire: PackResultWire,
  items: Map<string, Item>,
): TripPlan {
  return {
    items: wire.items
      .map((i) => toTripItem(i, items))
      .filter((i): i is TripItem => i !== null),
    days: wire.days.map((d) => toTripDay(wire.tripId, d, items)),
    missing: (wire.missing ?? []).map(toMissingPiece),
    minWearsPerItem: wire.everyPieceWornTwice ? 2 : null,
    gapFilled:
      wire.gapFilled === true ||
      (wire.missing ?? []).some((m) => Boolean(m.libraryItemId)),
  };
}

/**
 * `mapResult` of the pack job. A refused draft (`insufficient_wardrobe`, …) has nothing to accept:
 * it is raised so the screen shows the failure state with "Tekrar dene".
 */
export async function mapPackResult(result: unknown): Promise<TripPlan> {
  const wire = result as PackResultWire;
  if (wire.refusal) throw new PackRefusedError(wire.refusal);
  return toTripPlan(wire, await fetchItemMap());
}
