/**
 * API contracts used by the mobile app.
 *
 * ⚠ PROVISIONAL — these shapes were agreed for the first slice while the backend (`src/Api`) is
 * being built in parallel. Keep every request/response type here so they are easy to adjust once
 * the backend contract is final. Types are copied, never shared with the backend (MOBILE_ENGINEER §Tipler).
 *
 * Conventions assumed:
 * - JSON, camelCase; wire times are UTC ISO-8601; calendar dates are `YYYY-MM-DD`.
 * - Validation errors: RFC 9110 ProblemDetails (`detail`, optional `errors`).
 *   Business errors: ProblemDetails with a machine `code` (e.g. `email_taken`).
 * - Everything under `v1/tenant/*` needs `Authorization: Bearer {accessToken}`.
 * - PUT with `baseVersion` → 409 + `{ current }` when the server version moved on.
 */

import type { ImageVariants } from '@/lib/images';

// ---------- Auth ----------

/** The signed-in user as the app keeps it. `name` / `email` come from the form or `GET v1/tenant/profile`. */
export type AuthUser = {
  id: string;
  name: string;
  email: string;
  /**
   * 18+ confirmed (`ageConfirmedAt` on the profile). `false` → the confirmation screen comes before
   * anything else; absent on sessions stored before the check (`AgeCheckHost` asks the profile once).
   */
  ageConfirmed?: boolean;
  /**
   * The account's tenant id (auth responses carry it). Only used for the pseudonymous analytics actor
   * (`analytics/actor.ts`, = the server's `AnalyticsRules.Actor`); absent on sessions stored before it
   * was kept, until the next token refresh fills it in.
   */
  tenantId?: string;
};

/** Wire body of register / login / apple / google / refresh — see `./wire/core`. */
export type { AuthResponseWire as AuthResponse } from './wire/core';

/** POST v1/auth/register → 201. 409 `email_taken`, 429 `too_many_attempts`, 400 `age_confirmation_required`. */
export type RegisterRequest = { name: string; email: string; password: string; ageConfirmed: true };
/** POST v1/auth/login. 401 `invalid_credentials`, 429 `too_many_attempts`. */
export type LoginRequest = { email: string; password: string };
/**
 * What the Apple sheet gives the app. `nonce` is the RAW nonce; the app passes SHA-256(nonce) to Apple.
 * The name arrives only on the very first authorization (sent as `fullName { givenName, familyName }`).
 */
export type AppleAuthRequest = {
  identityToken: string;
  nonce: string;
  givenName?: string | null;
  familyName?: string | null;
  authorizationCode?: string | null;
};
/** POST v1/auth/google */
export type GoogleAuthRequest = { idToken: string; name?: string };
/** POST v1/auth/refresh — rotates: returns a new pair and invalidates the old refresh token. 401 `invalid_refresh_token`. */
export type RefreshRequest = { refreshToken: string };
/** POST v1/auth/logout → 204. `deviceId` also removes the push registration. */
export type LogoutRequest = { refreshToken: string; deviceId?: string };
/** POST v1/auth/password/forgot — always 202 (no account enumeration). */
export type ForgotPasswordRequest = { email: string };
/** POST v1/auth/password/reset → 204. 400 `invalid_or_expired_token`. `token` arrives via deep link. */
export type ResetPasswordRequest = { token: string; newPassword: string };

// ---------- Style profile (03) ----------

export type Segment = 'women' | 'men' | 'teen';
export type Budget = 'high_street' | 'mixed' | 'luxury_touch';
export const STYLE_TAGS = [
  'minimal',
  'classic',
  'quiet_luxury',
  'street',
  'boho',
  'sporty',
  'romantic',
  'office_chic',
  'colorful',
  'vintage',
] as const;
export type StyleTag = (typeof STYLE_TAGS)[number];

/** GET/PUT v1/tenant/style-profile (app shape; wire uses camelCase enums + `version`). GET → 404 when not set yet (baseVersion 0). */
export type StyleProfile = {
  segment: Segment;
  /** Exactly 3. */
  styleTags: StyleTag[];
  budget: Budget;
  baseVersion: number;
};
export type PutStyleProfileRequest = StyleProfile & { clientMutationId: string };

// ---------- Body profile (04) ----------

export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;
export type Size = (typeof SIZES)[number];

/** Body types of the face-path try-on (canvas 11 "Vücut tipi"); `unsure` = a balanced figure from height and size. */
export const BODY_TYPES = ['hourglass', 'pear', 'apple', 'rectangle', 'inverted_triangle', 'unsure'] as const;
export type BodyType = (typeof BODY_TYPES)[number];

/** GET/PUT v1/tenant/body-profile. GET → 404 when not set yet. */
export type BodyProfile = {
  heightCm: number;
  weightKg?: number | null;
  size: Size;
  /** Wire `bodyType` (camelCase enum); null = not chosen yet. On PUT, null/absent keeps the stored value. */
  bodyType?: BodyType | null;
  baseVersion: number;
};
export type PutBodyProfileRequest = BodyProfile & { clientMutationId: string };

// ---------- Photos (04) ----------

export type PhotoKind = 'body' | 'face';

/**
 * Upload flow (wire shapes in `./wire/core`): `POST v1/tenant/photo/upload-url { kind, contentType }`
 * → presigned S3 POST (`url` + `fields`, then the file) → `PUT v1/tenant/photo/{kind} { uploadId,
 * clientMutationId }` makes it the active photo. One active photo per kind.
 */
export type PhotoUploadUrlRequest = { kind: PhotoKind; contentType: 'image/jpeg' };

// ---------- Entitlement ----------

/** GET v1/tenant/entitlement, mapped from the wire (`premium` → `member`, `credits.totalRemaining` → `remaining`). */
export type Entitlement = {
  tier: 'free' | 'member';
  /**
   * `remaining` is what can be spent now (the month's allowance left + extra credits from packs or grants);
   * the counter shows the allowance and the extra credits apart, so "30 görselden 47'si" never appears.
   */
  credits: { monthlyAllowance: number; remaining: number; allowanceRemaining?: number; extraRemaining?: number; resetsAt: string };
  /** Billing period of the active membership ("Yıllık" on 28 Profil), read from the store product id; absent when unknown. */
  plan?: 'monthly' | 'yearly';
  /**
   * AI recognition of garment photos (owner decision 2026-11-18): free for non-members up to a
   * server-configured `limit`; `limit: null` = unlimited (members), then `remaining` is null too.
   * Optional until every environment sends it — absent means "ask the server".
   */
  itemRecognition?: ItemRecognitionQuota;
  /** StoreKit appAccountToken / Play obfuscatedAccountId for this account (null until the server sends it). */
  storeAccountToken?: string | null;
  /** Member whose renewal payment failed: access continues for the store's grace period. */
  inGracePeriod?: boolean;
  /**
   * Temporary self-serve premium (owner decision 2026-11-19, until store purchases are live): `enabled` = the
   * server switch is on (Ayarlar shows the section, the paywall the "for now, free" link); `active` = this
   * account turned it on. Absent = off.
   */
  selfServePremium?: { enabled: boolean; active: boolean };
  /**
   * "Kombinlerini içe aktar": photos per import for this plan (server configuration, per plan; owner change
   * 2026-11-19). Absent on an older server — the session answer (`maxPhotos`) brings it then.
   */
  outfitImportMaxPhotos?: number | null;
};

export type ItemRecognitionQuota = { limit: number | null; used: number; remaining: number | null };

// ---------- Errors ----------

export type ProblemDetails = {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  code?: string;
  errors?: Record<string, string[]>;
  /** On 409: the server's current record. */
  current?: unknown;
  /** On 403 `consent_required`: the consent types that are missing (`ConsentType`). */
  missing?: string[];
};

// ---------- NOT YET AGREED (fixture-backed in this slice) ----------
// Screen 06 Bugün and 04b İlk 5 parça have no backend contract yet (epics E4 / E2).
// Their shapes below drive the fixtures and must be confirmed before wiring to the API.

export type Occasion = 'office' | 'dinner' | 'weekend' | 'wedding' | 'travel' | 'sport' | 'evening';

/** Wardrobe pieces also carry the item's image variants (`itemImageSource` picks one). */
export type LookPiece = ImageVariants & {
  id: string;
  name: string;
  /** 'wardrobe' = the user owns it; 'store' = missing piece suggested from the catalogue. */
  source: 'wardrobe' | 'store';
  imageUrl: string | null;
  /** Wardrobe category / colour of the piece, when known: glyph and ground of its placeholder while there is no picture. */
  category?: string | null;
  color?: string | null;
};

export type TodayLook = {
  id: string;
  name: string;
  occasion: Occasion;
  /** Private, short-lived signed URL of the try-on image (owner only). */
  tryOnImageUrl: string | null;
  pieces: LookPiece[];
  isFavorite: boolean;
  wornToday: boolean;
};

export type WeekDay = { date: string; hasPlan: boolean };

export type WeeklyEditCard = {
  id: string;
  /** ISO date of the day the look belongs to. */
  date: string;
  name: string;
  imageUrl: string | null;
};

/** GET v1/tenant/today?date= as the Bugün card shows it (mapped in `./wire/today`; `weeklyEdit` from GET v1/content/edit/current). */
export type TodayResponse = {
  date: string;
  weather: { temperatureC: number; city: string } | null;
  firstName: string;
  occasion: Occasion | null;
  look: TodayLook | null;
  week: WeekDay[];
  weeklyEdit: WeeklyEditCard[];
};

/** POST v1/tenant/wear-log (event; idempotent on clientMutationId, which is also the log id). */
export type WearLogRequest = { lookId: string; date: string; occurredAt: string; clientMutationId: string };

/** GET v1/tenant/library/item — ready-made piece library (04b / 12b); names in the profile language. */
export type LibraryItem = {
  id: string;
  name: string;
  category: string;
  imageUrl: string | null;
  /** Main colour (wardrobe colour vocabulary), when the library knows it: ground of the placeholder while there is no picture. */
  color?: string | null;
};
