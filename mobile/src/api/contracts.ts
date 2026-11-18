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

// ---------- Auth ----------

export type AuthUser = { id: string; name: string; email: string };

export type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
  user: AuthUser;
};

/** POST v1/auth/register */
export type RegisterRequest = { name: string; email: string; password: string };
/** POST v1/auth/login */
export type LoginRequest = { email: string; password: string };
/**
 * POST v1/auth/apple — `nonce` is the RAW nonce; the app passes SHA-256(nonce) to Apple, so the
 * identity token's `nonce` claim is the hex SHA-256 of this value. `fullName` only on first sign-in.
 */
export type AppleAuthRequest = { identityToken: string; nonce: string; fullName?: string };
/** POST v1/auth/google */
export type GoogleAuthRequest = { idToken: string };
/** POST v1/auth/refresh — rotates: returns a new pair and invalidates the old refresh token. */
export type RefreshRequest = { refreshToken: string };
/** POST v1/auth/logout — body assumed `{ refreshToken }` so the server can revoke it. */
export type LogoutRequest = { refreshToken: string };
/** POST v1/auth/password/forgot — always 202/204 (no account enumeration). */
export type ForgotPasswordRequest = { email: string };
/** POST v1/auth/password/reset — `token` arrives via deep link `droplet://reset-password?token=…`. */
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

/** GET/PUT v1/tenant/style-profile. GET → 404 when not set yet (treated as baseVersion 0). */
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

/** GET/PUT v1/tenant/body-profile. GET → 404 when not set yet. */
export type BodyProfile = {
  heightCm: number;
  weightKg?: number | null;
  size: Size;
  baseVersion: number;
};
export type PutBodyProfileRequest = BodyProfile & { clientMutationId: string };

// ---------- Photos (04) ----------

export type PhotoKind = 'body' | 'face';

/** POST v1/tenant/photo/upload-url */
export type PhotoUploadUrlRequest = { kind: PhotoKind; contentType: 'image/jpeg' };
export type PhotoUploadUrlResponse = {
  photoId: string;
  /** Presigned S3 PUT URL. Upload with header `Content-Type` = requested contentType. */
  uploadUrl: string;
  expiresAt: string;
};
/**
 * PUT v1/tenant/photo/{kind} — confirms the uploaded object.
 * Assumption: `body` accepts up to 3 photos (each confirm adds one); `face` replaces the previous one.
 * Idempotent on `clientMutationId`.
 */
export type ConfirmPhotoRequest = { photoId: string; clientMutationId: string };

// ---------- Entitlement ----------

/** GET v1/tenant/entitlement. Assumed tiers: 'free' | 'member'. */
export type Entitlement = {
  tier: 'free' | 'member';
  credits: { monthlyAllowance: number; remaining: number; resetsAt: string };
  /**
   * AI recognition of garment photos (owner decision 2026-11-18): free for non-members up to a
   * server-configured `limit`; `limit: null` = unlimited (members), then `remaining` is null too.
   * Optional until every environment sends it — absent means "ask the server".
   */
  itemRecognition?: ItemRecognitionQuota;
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
};

// ---------- NOT YET AGREED (fixture-backed in this slice) ----------
// Screen 06 Bugün and 04b İlk 5 parça have no backend contract yet (epics E4 / E2).
// Their shapes below drive the fixtures and must be confirmed before wiring to the API.

export type Occasion = 'office' | 'dinner' | 'weekend' | 'wedding' | 'travel' | 'sport' | 'evening';

export type LookPiece = {
  id: string;
  name: string;
  /** 'wardrobe' = the user owns it; 'store' = missing piece suggested from the catalogue. */
  source: 'wardrobe' | 'store';
  imageUrl: string | null;
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

/** Candidate: GET v1/tenant/today */
export type TodayResponse = {
  date: string;
  weather: { temperatureC: number; city: string } | null;
  firstName: string;
  occasion: Occasion | null;
  look: TodayLook | null;
  week: WeekDay[];
  weeklyEdit: WeeklyEditCard[];
};

/** Candidate: POST v1/tenant/wear-logs (event; idempotent on clientMutationId). */
export type WearLogRequest = { lookId: string; date: string; occurredAt: string; clientMutationId: string };

/** Candidate: GET v1/catalog/library (ready-made piece library for 04b / 12b). */
export type LibraryItem = { id: string; name: string; category: string; imageUrl: string | null };
