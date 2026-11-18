/**
 * E5 Stilist — PROVISIONAL contract (BACKEND_ENGINEER §Uç nokta haritası, E5). Text suggestions do
 * not use AI credits; only the try-on image of a suggestion does (see contracts/tryon.ts).
 */
import type { Occasion } from '../contracts';
import type { JobAccepted } from './jobs';
import type { LookSlotKind } from './looks';
import type { ItemCategory, ItemColor } from './wardrobe';

export const STYLIST_TEXT_MAX = 140;
export const STYLIST_TEXT_MIN = 3;
export const STYLIST_SUGGESTION_COUNT = 3;

/**
 * POST v1/tenant/stylist/outfit → 202 `JobAccepted` (job kind `stylist-outfit`). Idempotent on `requestId`.
 * At least one of `occasion` / `text` is required. `itemIds`: pieces every suggestion must contain
 * ("Bununla kombin yap"). `cityId` null → the server uses the profile city / last known location.
 */
export type StylistOutfitRequest = {
  requestId: string;
  /** Calendar day the outfit is for, `YYYY-MM-DD`. */
  date: string;
  occasion: Occasion | null;
  /** Free text, e.g. "akşam iş yemeği, yağmurlu" (≤ 140 chars). */
  text: string | null;
  cityId: string | null;
  wardrobeOnly: boolean;
  itemIds?: string[];
};
export type StylistOutfitResponse = JobAccepted;

export type StylistPiece = {
  slot: LookSlotKind;
  /** 'wardrobe' → `refId` is an Item id; 'store' → a catalogue product id (a missing piece). */
  source: 'wardrobe' | 'store';
  refId: string;
  name: string;
  brand: string | null;
  /** TRY, store pieces only. */
  price: number | null;
  imageUrl: string | null;
  category: ItemCategory;
  color: ItemColor | null;
};

export type StylistSuggestion = {
  /** 0-based position, stable for the job. */
  index: number;
  name: string;
  /** The stylist's short note. */
  note: string;
  pieces: StylistPiece[];
  /** Existing try-on image for this suggestion (owner only, signed URL), when one was generated. */
  tryOnImageUrl: string | null;
  /** Set once the suggestion was accepted ("Takvime ekle" / heart). */
  savedLookId: string | null;
  plannedDate: string | null;
};

export type StylistWeather = { temperatureC: number; summary: string | null; city: string | null };

/** Result of a `stylist-outfit` job (GET v1/tenant/job/{id} → `result`). */
export type StylistOutfitResult = {
  request: Pick<StylistOutfitRequest, 'date' | 'occasion' | 'text' | 'wardrobeOnly'>;
  /** Exactly 3. */
  suggestions: StylistSuggestion[];
  /** Null when the forecast could not be read. */
  weather: StylistWeather | null;
};

/**
 * POST v1/tenant/stylist/suggestion/{jobId}/{index}/accept — writes the suggestion as a Look
 * (`lookId` = ULID from the device) and, when `date` is set, as that day's PlanDay. Idempotent.
 */
export type AcceptSuggestionRequest = { lookId: string; date: string | null; clientMutationId: string; occurredAt: string };
export type AcceptSuggestionResponse = { lookId: string; plannedDate: string | null };

export const STYLIST_DISLIKE_REASONS = ['occasion', 'colors', 'piece', 'weather', 'too_formal'] as const;
export type StylistDislikeReason = (typeof STYLIST_DISLIKE_REASONS)[number];

/** POST v1/tenant/feedback — "Beğenmedim" on a suggestion. Event; idempotent on `clientMutationId`. */
export type StylistFeedbackRequest = {
  kind: 'stylist_suggestion';
  jobId: string;
  index: number;
  reasons: StylistDislikeReason[];
  note: string | null;
  clientMutationId: string;
  occurredAt: string;
};

/**
 * Context shown on 16 before asking (weather badge). Assumed: GET v1/weather?from=&to= (cityId
 * omitted → profile city) answering `{ city, days: [{ date, temperatureC, summary }] }`.
 */
export type WeatherForecastResponse = { city: string | null; days: { date: string; temperatureC: number; summary: string | null }[] };
