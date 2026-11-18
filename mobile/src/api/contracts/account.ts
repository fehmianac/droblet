import type { AppLanguage } from '@/i18n';

import type { StyleTag } from '../contracts';
import type { CatalogColor } from './store';

/**
 * E1 / E7 / E11 — Profil (28), Gizlilik ve ayarlar (29), Renk paletim (30).
 *
 * ⚠ PROVISIONAL — shapes assumed from the endpoint map in BACKEND_ENGINEER.md.
 */

export const CLOSET_VISIBILITIES = ['public', 'followers', 'private'] as const;
export type ClosetVisibility = (typeof CLOSET_VISIBILITIES)[number];

/** GET v1/tenant/profile */
export type MyProfile = {
  handle: string | null;
  displayName: string;
  avatarUrl: string | null;
  styleTags: StyleTag[];
  /** Default is an open decision (A-6) — the app shows whatever the server returns. */
  closetVisibility: ClosetVisibility;
  /** Language for server content, e-mails and notifications; null until the app saved one. */
  language: AppLanguage | null;
  baseVersion: number;
};

/** GET v1/tenant/profile/stats */
export type ProfileStats = { itemCount: number; lookCount: number; followerCount: number; tripCount: number };

/** PUT v1/tenant/profile/visibility → the updated profile; 409 + `{ current }` when the version moved on. */
export type PutVisibilityRequest = { closetVisibility: ClosetVisibility; baseVersion: number; clientMutationId: string };

/** PUT v1/tenant/profile — assumption: a partial, versioned update carrying only `language` → the updated profile. */
export type PutProfileLanguageRequest = { language: AppLanguage; baseVersion: number; clientMutationId: string };

/** GET v1/tenant/photo — metadata + short-lived signed URLs (never persisted). */
export type PhotoMeta = { photoId: string; url: string | null };
export type MyPhotos = {
  body: PhotoMeta[];
  face: PhotoMeta | null;
  /** Assumption: count of try-on images generated on the user, shown in the 29b confirmation. */
  generatedImageCount: number | null;
};
/** ASSUMED: DELETE v1/tenant/photo/{kind}/{photoId} — remove one photo (29 list). */
export type RemovePhotoRequest = { kind: 'body' | 'face'; photoId: string; clientMutationId: string };
/** DELETE v1/tenant/photo — photos, every generated image and the palette source (29b). */
export type DeleteAllPhotosRequest = { clientMutationId: string };

/**
 * GET / PUT v1/tenant/user/me/notifications. Times are UTC `HH:mm` on the wire.
 * Assumption: one boolean per notification type shown in 29 + the morning reminder time.
 */
export type NotificationSettings = {
  morningReminder: boolean;
  morningTimeUtc: string;
  weeklyEdit: boolean;
  friendRatings: boolean;
  baseVersion: number;
};
export type PutNotificationSettingsRequest = NotificationSettings & { clientMutationId: string };

// ---------- Palette (30) ----------

export const SEASON_TYPES = [
  'light_spring',
  'warm_spring',
  'clear_spring',
  'light_summer',
  'cool_summer',
  'soft_summer',
  'soft_autumn',
  'warm_autumn',
  'deep_autumn',
  'deep_winter',
  'cool_winter',
  'clear_winter',
] as const;
export type SeasonType = (typeof SEASON_TYPES)[number];

export type PaletteTone = {
  /** Colour value from the analysis (data, not a design token). */
  hex: string;
  /** Localized by the server; Turkish is always present. */
  name: { tr: string } & Partial<Record<AppLanguage, string>>;
  /** Catalogue colour this tone maps to, for "Paletime uygun ürünler". */
  catalogColor: CatalogColor | null;
};

/**
 * GET v1/tenant/palette → 404 when no analysis exists.
 * `status: 'pending'` while the Palette worker runs (POST v1/tenant/palette/analyze → 202).
 */
export type Palette =
  | { status: 'pending' }
  | { status: 'failed' }
  | {
      status: 'ready';
      seasonType: SeasonType;
      /** 8 tones. */
      tones: PaletteTone[];
      avoid: PaletteTone[];
      /** 0–100; null with an empty wardrobe. */
      wardrobeMatchPercent: number | null;
    };

/** POST v1/tenant/palette/analyze — 422 `face_photo_required`. */
export type AnalyzePaletteRequest = { requestId: string; clientMutationId: string };

/** GET v1/tenant/palette/mismatch */
export type PaletteMismatch = { items: { id: string; name: string; imageUrl: string | null }[] };

/** DELETE v1/auth/me — account deletion (29c). Online only. */
export type DeleteAccountResponse = void;
