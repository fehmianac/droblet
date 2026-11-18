/**
 * Wire shapes of the weather endpoints (docs/api/store-social-settings.md §10) and of the weather
 * block embedded in today / trip days (docs/api/wardrobe-looks-plan-stylist.md §5), with the mappers
 * to the app's city and forecast types.
 */
import i18n from '@/i18n';
import { getActiveQueryClient } from '@/sync/activeClient';

import { apiRequest } from '../client';
import type { WeatherForecastResponse } from '../contracts/stylist';
import type { City, WeatherCondition } from '../contracts/trips';

export type WeatherConditionWire =
  | 'clear'
  | 'partlyCloudy'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'showers'
  | 'thunderstorm'
  | 'unknown';

/** GET v1/weather/city?q= → `CityWire[]`; also `SettingsDto.city` and `WeatherForecast.city`. */
export type CityWire = {
  id: string;
  name: string;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  latitude: number;
  longitude: number;
  timeZone: string | null;
};

/** GET v1/weather?cityId= | ?lat=&lon= (optional days=1–7). 404 `city_not_found`, 503 `weather_unavailable`. */
export type WeatherForecastWire = {
  locationKey: string;
  city: CityWire | null;
  fetchedAt: string;
  days: {
    date: string;
    minC: number;
    maxC: number;
    condition: WeatherConditionWire;
    weatherCode: number;
    precipitationProbability: number | null;
  }[];
};

/** `weather` of `GET v1/tenant/today` and of a trip day: whole °C, null when nothing is known. */
export type DayWeatherWire = {
  date: string;
  minTempC: number;
  maxTempC: number;
  condition: WeatherConditionWire;
  precipitationChance: number | null;
};

/** "İstanbul" + "Türkiye" → the line under the city name; a region equal to the city name is dropped. */
export function toCity(wire: CityWire): City {
  const parts = [wire.region, wire.country].filter((p): p is string => Boolean(p) && p !== wire.name);
  return { id: wire.id, name: wire.name, region: [...new Set(parts)].join(', ') };
}

const GLYPH: Record<WeatherConditionWire, WeatherCondition> = {
  clear: 'sun',
  partlyCloudy: 'cloud',
  cloudy: 'cloud',
  fog: 'cloud',
  unknown: 'cloud',
  drizzle: 'rain',
  rain: 'rain',
  showers: 'rain',
  thunderstorm: 'rain',
  snow: 'snow',
};

export function toWeatherGlyph(condition: WeatherConditionWire | null | undefined): WeatherCondition {
  return (condition && GLYPH[condition]) || 'cloud';
}

/** The condition as a short localized word ("yağmurlu"); null for `unknown`. */
export function weatherSummary(condition: WeatherConditionWire | null | undefined): string | null {
  if (!condition || condition === 'unknown' || !(condition in GLYPH)) return null;
  return i18n.t(`weatherCondition.${condition}`);
}

export function toForecast(wire: WeatherForecastWire): WeatherForecastResponse {
  return {
    city: wire.city?.name ?? null,
    days: wire.days.map((d) => ({ date: d.date, temperatureC: Math.round(d.maxC), summary: weatherSummary(d.condition) })),
  };
}

type SettingsCityWire = { cityId: string | null };

async function requestProfileCityId(): Promise<string | null> {
  return (await apiRequest<SettingsCityWire>('v1/tenant/settings')).cityId ?? null;
}

/** The profile city (`GET v1/tenant/settings` → `cityId`), cached for five minutes. Null until the user picked one. */
export function fetchProfileCityId(): Promise<string | null> {
  const client = getActiveQueryClient();
  if (!client) return requestProfileCityId();
  return client.fetchQuery({ queryKey: ['tenant', 'settings', 'city-id'], queryFn: requestProfileCityId, staleTime: 5 * 60_000 });
}

/**
 * The forecast for the profile city. `GET v1/weather` cannot be called without a location, so an
 * account without a city gets an empty forecast instead of a request.
 */
export async function fetchProfileForecast(): Promise<WeatherForecastResponse> {
  const cityId = await fetchProfileCityId();
  if (!cityId) return { city: null, days: [] };
  return toForecast(await apiRequest<WeatherForecastWire>(`v1/weather?cityId=${encodeURIComponent(cityId)}`));
}
