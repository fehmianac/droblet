import type { AppLanguage } from '@/i18n';

import type { StyleTag } from '../contracts';
import type { CatalogColor } from './store';

/**
 * E1 / E7 / E11 — Profil (28), Gizlilik ve ayarlar (29), Renk paletim (30).
 *
 * These are the APP types the screens render. The wire shapes of the real endpoints and the mappers
 * are in `../wire/account.ts` and `../wire/palette.ts` (docs/api/store-social-settings.md §7,
 * docs/api/wardrobe-looks-plan-stylist.md §8).
 */

/** Wire: `public` | `followersOnly` | `private` (default). */
export const CLOSET_VISIBILITIES = ['public', 'followers', 'private'] as const;
export type ClosetVisibility = (typeof CLOSET_VISIBILITIES)[number];

/** GET v1/tenant/profile (+ style tags from GET v1/tenant/style-profile). */
export type MyProfile = {
  /** Without the leading @; null until claimed (`PUT v1/tenant/profile/handle`). */
  handle: string | null;
  displayName: string;
  /** No avatars in phase 1 — always null from the API. */
  avatarUrl: string | null;
  styleTags: StyleTag[];
  closetVisibility: ClosetVisibility;
  /** Language for server content, e-mails and notifications; null when the server's is not an app language. */
  language: AppLanguage | null;
  /** City id from `GET v1/weather/city` (weather on Bugün, stylist); null until chosen. */
  cityId?: string | null;
  email?: string | null;
  baseVersion: number;
};

/** GET v1/tenant/profile/stats */
export type ProfileStats = { itemCount: number; lookCount: number; followerCount: number; followingCount?: number; tripCount: number };

/**
 * GET v1/tenant/profile/handle/availability?handle= — live check while typing. `available` is also
 * true for my own current handle. Codes: `handle_invalid`, `handle_reserved`, `handle_taken`.
 */
export type HandleAvailability = { handle: string; available: boolean; code: 'handle_invalid' | 'handle_reserved' | 'handle_taken' | null };

/** PUT v1/tenant/profile — partial, versioned; carries only `displayName`. 400 `name_required`. */
export type PutProfileNameRequest = { displayName: string; baseVersion: number; clientMutationId: string };

/** PUT v1/tenant/profile/visibility → the updated profile; 409 + the current profile when the version moved on. */
export type PutVisibilityRequest = { closetVisibility: ClosetVisibility; baseVersion: number; clientMutationId: string };

/** PUT v1/tenant/profile — partial, versioned; carries only `language`. 400 `language_unsupported`. */
export type PutProfileLanguageRequest = { language: AppLanguage; baseVersion: number; clientMutationId: string };

/** PUT v1/tenant/profile — partial, versioned; carries only `cityId` (`""` clears the city). */
export type PutProfileCityRequest = { cityId: string; baseVersion: number; clientMutationId: string };

/** GET v1/weather/city?q= (2–60 chars, ≤ 8 rows, names in the request language). */
export type CityOption = { id: string; name: string; region: string | null; country: string | null };

/**
 * "Profili düzenle" (28) — what the form saves. On the wire it is two calls: `displayName` goes in the
 * partial `PUT v1/tenant/profile { displayName, baseVersion }`, a changed handle in
 * `PUT v1/tenant/profile/handle { handle }` (409 `handle_taken`, 422 `handle_reserved`).
 * `avatarPhotoId` is fixture-only: the API has no avatar upload yet.
 */
export type UpdateProfileRequest = {
  displayName: string;
  handle: string;
  avatarPhotoId?: string | null;
  baseVersion: number;
  clientMutationId: string;
};

/** GET v1/tenant/photo — metadata + short-lived signed URLs (never persisted). */
export type PhotoMeta = { photoId: string; url: string | null };
export type MyPhotos = {
  /** The server keeps ONE active body photo; the list has 0 or 1 entry. */
  body: PhotoMeta[];
  face: PhotoMeta | null;
  /** Count of try-on images generated on the user; the API does not send it (null → "every generated image"). */
  generatedImageCount: number | null;
};
/** DELETE v1/tenant/photo/{kind}/{photoId} → 204; 404 when that is not the active photo of the kind. */
export type RemovePhotoRequest = { kind: 'body' | 'face'; photoId: string; clientMutationId: string };
/** DELETE v1/tenant/photo → 204 — photos, every generated image and the palette result (29b). */
export type DeleteAllPhotosRequest = { clientMutationId: string };

/**
 * GET / PUT v1/tenant/user/me/notifications. `morningTimeLocal` is the user's LOCAL wall-clock time
 * (`HH:mm`, quarter hours); the device's IANA time zone travels with every PUT, so the reminder
 * stays correct across daylight-saving changes. `baseVersion: 0` = never saved (all off).
 */
export type NotificationSettings = {
  morningReminder: boolean;
  morningTimeLocal: string;
  weeklyEdit: boolean;
  friendRatings: boolean;
  /** A watched product got cheaper (only products whose bell is on). Off by default. */
  priceDrop: boolean;
  /** Somebody asked to follow me. Off by default. */
  followRequests: boolean;
  baseVersion: number;
};
export type PutNotificationSettingsRequest = NotificationSettings & { clientMutationId: string };

// ---------- Palette (30) ----------

/** The server's season type ids are the same words in kebab-case (`warm-autumn`, `bright-spring`). */
export const SEASON_TYPES = [
  'light_spring',
  'warm_spring',
  'bright_spring',
  'light_summer',
  'cool_summer',
  'soft_summer',
  'soft_autumn',
  'warm_autumn',
  'deep_autumn',
  'deep_winter',
  'cool_winter',
  'bright_winter',
] as const;
export type SeasonType = (typeof SEASON_TYPES)[number];

export type PaletteTone = {
  /** Reference colour id (`camel`); absent on fixtures. */
  id?: string;
  /** Colour value from the analysis (data, not a design token). */
  hex: string;
  /** From the API: one string, already in the request language. Fixtures carry a per-language map. */
  name: string | ({ tr: string } & Partial<Record<AppLanguage, string>>);
  /** Catalogue colour this tone maps to, for "Paletime uygun ürünler". */
  catalogColor: CatalogColor | null;
};

/**
 * GET v1/tenant/palette → 404 `palette_not_found` when no analysis exists (the app's `null`).
 * `pending` while the palette job started by POST v1/tenant/palette/analyze runs; `failed` when it failed.
 */
export type Palette =
  | { status: 'pending' }
  | { status: 'failed'; /** App code of the job failure, e.g. `no_face_detected`. */ reason?: string }
  | {
      status: 'ready';
      seasonType: SeasonType;
      tones: PaletteTone[];
      avoid: PaletteTone[];
      /** 0–100; null with an empty wardrobe. */
      wardrobeMatchPercent: number | null;
      /** True → the analysis was unsure; a new photo is worth suggesting. */
      lowConfidence?: boolean;
      /** False → the face photo was replaced since the analysis. */
      sourcePhotoActive?: boolean;
    };

/** POST v1/tenant/palette/analyze `{ requestId }` → 202 job | 200 cached. 422 `face_photo_required`, 403 `premium_required`. */
export type AnalyzePaletteRequest = { requestId: string; clientMutationId: string };

/** GET v1/tenant/palette/mismatch */
export type PaletteMismatch = {
  /** Wardrobe pieces; `category` / `color` (wardrobe vocabulary, optional) draw the placeholder while there is no picture. */
  items: { id: string; name: string; imageUrl: string | null; category?: string | null; color?: string | null }[];
};

/** DELETE v1/auth/me → 204 — account deletion (29c). Online only. */
export type DeleteAccountResponse = void;
