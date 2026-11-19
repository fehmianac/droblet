/**
 * E5 Stilist — the app-side shapes. The wire shapes (docs/api/wardrobe-looks-plan-stylist.md §6, §9)
 * and the mapping live in `../wire/stylist`. Text suggestions need the membership (403
 * `premium_required`) but no AI credit; only the try-on image of a suggestion costs one.
 */
import type { Money } from '@/lib/format';
import type { Occasion } from '../contracts';
import type { JobAccepted } from './jobs';
import type { LookSlotKind } from './looks';
import type { ItemCategory, ItemColor } from './wardrobe';

export const STYLIST_TEXT_MAX = 140;
export const STYLIST_TEXT_MIN = 3;
export const STYLIST_SUGGESTION_COUNT = 3;

/**
 * POST v1/tenant/stylist/outfit → 202 job (kind `stylistOutfit`). Idempotent on `requestId`.
 * Sent as `{ requestId, date, occasion, freeText, onlyMyWardrobe, pinnedItemId, cityId }`: `text` →
 * `freeText` (≤ 200 on the server), `wardrobeOnly` → `onlyMyWardrobe`, the first of `itemIds` →
 * `pinnedItemId` ("Bununla kombin yap" pins one piece). `cityId` null → the server uses the profile city.
 * Errors: 403 `premium_required`, 409 `request_id_reused`, 422 `item_not_found`.
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
  /**
   * 'wardrobe' → `refId` is an Item id; 'store' → a catalogue product id (a missing piece);
   * 'library' → a ready-made library piece id the stylist picked for a thin wardrobe ("Önerilen · Kütüphane").
   */
  source: 'wardrobe' | 'store' | 'library';
  /** Picked by Droblet to fill a gap of a thin wardrobe (wire result `gapFilled`): shown as "Önerilen · …". */
  suggested?: boolean;
  refId: string;
  name: string;
  brand: string | null;
  /** Store pieces only (minor units + ISO currency). */
  price: Money | null;
  imageUrl: string | null;
  category: ItemCategory;
  color: ItemColor | null;
};

export type StylistSuggestion = {
  /** 0-based position, stable for the job. */
  index: number;
  /** Wire `title`; the app's neutral name when the suggestion is the rule-based fallback (`source: "rule"`). */
  name: string;
  /** Wire `explanation` (the stylist's short note); the app's neutral text for the rule-based fallback. */
  note: string;
  pieces: StylistPiece[];
  /** Not sent with the job result; an existing image is read with `GET v1/tenant/tryon?kind=suggestion`. */
  tryOnImageUrl: string | null;
  /** Client-side: set once the suggestion was accepted ("Takvime ekle" / heart). */
  savedLookId: string | null;
  plannedDate: string | null;
};

export type StylistWeather = { temperatureC: number; summary: string | null; city: string | null };

export type StylistRefusal = 'insufficient_wardrobe' | 'out_of_scope';

/** Result of a `stylist-outfit` job, mapped from the wire `OutfitResult` (ids only) + the wardrobe / catalogue. */
export type StylistOutfitResult = {
  request: Pick<StylistOutfitRequest, 'date' | 'occasion' | 'text' | 'wardrobeOnly'>;
  /** Up to 3; empty when the stylist refused (`refusal`). */
  suggestions: StylistSuggestion[];
  /** The job result carries no forecast (the badge on 16 reads `GET v1/weather`); always null from the API. */
  weather: StylistWeather | null;
  /** Why there are no suggestions: the wardrobe cannot dress the day, or the request is not about outfits. */
  refusal?: StylistRefusal | null;
  /** Some pieces were picked by Droblet (library / store) because the wardrobe is thin: the soft banner shows. */
  gapFilled?: boolean;
};

/**
 * POST v1/tenant/stylist/suggestion/{jobId}/{index}/accept — sent as `{ clientMutationId, lookId,
 * name: null, planDate, favorite: false }` → `{ look, planDay }`. Writes the suggestion as a Look
 * (`lookId` = ULID from the device) and, when `date` is set, as that day's PlanDay. Idempotent.
 * Errors: 404 `job_not_found` / `suggestion_not_found`, 409 `job_not_completed` / `suggestion_stale` / `look_id_taken`.
 */
export type AcceptSuggestionRequest = { lookId: string; date: string | null; clientMutationId: string; occurredAt: string };
export type AcceptSuggestionResponse = { lookId: string; plannedDate: string | null };

export const STYLIST_DISLIKE_REASONS = ['occasion', 'colors', 'piece', 'weather', 'too_formal'] as const;
export type StylistDislikeReason = (typeof STYLIST_DISLIKE_REASONS)[number];

/**
 * "Beğenmedim" on a suggestion → `POST v1/tenant/stylist/suggestion/{jobId}/{index}/dislike { reason }`
 * (204). The wire takes ONE `DislikeReason` (`notMyStyle | wrongOccasion | wrongWeather | colorMismatch
 * | wornTooOften | other`): the first chip the user picked is sent (none → `other`); the free-text note
 * has no wire field and stays on the device.
 */
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
 * Context shown on 16 before asking (weather badge), mapped from `GET v1/weather?cityId=` (`../wire/weather`).
 * The endpoint needs a city: the profile city (`GET v1/tenant/settings`) is used; without one there is
 * no forecast (`days: []`). `temperatureC` = the day's maximum, `summary` = the localized condition.
 */
export type WeatherForecastResponse = { city: string | null; days: { date: string; temperatureC: number; summary: string | null }[] };
