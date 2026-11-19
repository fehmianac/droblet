/**
 * Wire shapes of the foundation endpoints (auth, profile, style / body profile, photos, entitlement,
 * jobs) exactly as the backend sends them (`src/Api/Endpoints/V1/Auth`, `…/Tenant/{Profile,Photo,
 * StyleProfile,BodyProfile,Entitlement,Job}`), plus the mappers to the app's own types.
 *
 * Rule of the API layer: screens and components only see the app types in `../contracts*`; every
 * request / response is converted here, at the boundary. Wire JSON is camelCase with camelCase enum
 * strings (`quietLuxury`, `highStreet`); the app keeps its snake_case keys (they are i18n keys).
 */
import type { BodyProfile, BodyType, Budget, Entitlement, Segment, Size, StyleProfile, StyleTag } from '../contracts';
import type { Job, JobKind, JobStatus } from '../contracts/jobs';

// ---------- enum spelling ----------

/** `quietLuxury` → `quiet_luxury` (wire → app). */
export function toSnake<T extends string = string>(value: string): T {
  return value.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`) as T;
}

/** `quiet_luxury` → `quietLuxury` (app → wire). */
export function toCamel<T extends string = string>(value: string): T {
  return value.replace(/[_-]([a-z0-9])/g, (_, c: string) => c.toUpperCase()) as T;
}

// ---------- auth ----------

/** Body of register (201), login, apple, google and refresh (200). */
export type AuthResponseWire = {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  userId: string;
  tenantId: string;
  /** True when this call created the account (register, first Apple / Google sign-in). */
  isNewUser: boolean;
};

/** POST v1/auth/apple */
export type AppleAuthRequestWire = {
  identityToken: string;
  nonce: string;
  fullName?: { givenName: string | null; familyName: string | null };
  /** One-time code from the same Apple sheet; the server exchanges it so account deletion can revoke the Apple token. */
  authorizationCode?: string;
};

/** GET / PUT v1/tenant/profile (+ /visibility, /handle). */
export type ProfileWire = {
  tenantId: string;
  displayName: string | null;
  handle: string | null;
  email: string | null;
  closetVisibility: 'public' | 'followersOnly' | 'private';
  language: string;
  cityId: string | null;
  version: number;
  updatedAt: string;
  /** 18+ confirmation (sign-up box or the one-time screen after Apple / Google); null = not confirmed. Older servers omit it. */
  ageConfirmedAt?: string | null;
  /** Profile photo (presigned GET, short-lived); null = none. Older servers omit it. */
  avatarUrl?: string | null;
  avatarUrlExpiresAt?: string | null;
  /** E-mail verification (docs/api/verification-export.md §1). Older servers omit it (= verified). */
  emailVerified?: boolean;
  emailVerifiedAt?: string | null;
};

// ---------- style / body profile ----------

export type StyleProfileWire = {
  segment: Segment;
  styleTags: string[];
  budget: string;
  version: number;
  updatedAt: string;
};
export type PutStyleProfileWire = { segment: Segment; styleTags: string[]; budget: string; baseVersion: number };

export function toStyleProfile(wire: StyleProfileWire): StyleProfile {
  return {
    segment: wire.segment,
    styleTags: wire.styleTags.map((t) => toSnake<StyleTag>(t)),
    budget: toSnake<Budget>(wire.budget),
    baseVersion: wire.version,
  };
}

export function fromStyleProfile(profile: StyleProfile): PutStyleProfileWire {
  return {
    segment: profile.segment,
    styleTags: profile.styleTags.map((t) => toCamel(t)),
    budget: toCamel(profile.budget),
    baseVersion: profile.baseVersion,
  };
}

/** `size` is the ClothingSize enum in lower case on the wire (`xs`, `xxl`); input is case-insensitive. */
export type BodyTypeWire = 'hourglass' | 'pear' | 'apple' | 'rectangle' | 'invertedTriangle' | 'unsure';
export type BodyProfileWire = { heightCm: number; weightKg: number | null; size: string; bodyType?: BodyTypeWire | null; version: number; updatedAt: string };
export type PutBodyProfileWire = { heightCm: number; weightKg: number | null; size: string; bodyType?: BodyTypeWire; baseVersion: number };

export function toBodyProfile(wire: BodyProfileWire): BodyProfile {
  return {
    heightCm: wire.heightCm,
    weightKg: wire.weightKg,
    size: wire.size.toUpperCase() as Size,
    bodyType: wire.bodyType ? toSnake<BodyType>(wire.bodyType) : null,
    baseVersion: wire.version,
  };
}

/** `bodyType` is only sent when chosen: an absent value keeps the stored one (a PUT from 04 never clears it). */
export function fromBodyProfile(profile: BodyProfile): PutBodyProfileWire {
  return {
    heightCm: profile.heightCm,
    weightKg: profile.weightKg ?? null,
    size: profile.size,
    ...(profile.bodyType ? { bodyType: toCamel<BodyTypeWire>(profile.bodyType) } : {}),
    baseVersion: profile.baseVersion,
  };
}

// ---------- photos ----------

/** POST v1/tenant/photo/upload-url (and each entry of item/upload-url): a presigned S3 **POST**. */
export type PresignedPostWire = {
  uploadId: string;
  /** Form action. Send every entry of `fields` first, then the file as `file`. */
  url: string;
  fields: Record<string, string>;
  expiresAt: string;
  maxBytes: number;
};

export type PhotoWire = {
  id: string;
  kind: 'body' | 'face';
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  /** Short-lived presigned GET. */
  url: string;
  urlExpiresAt: string;
};
/** GET v1/tenant/photo — one active photo per kind. */
export type PhotosWire = { body: PhotoWire | null; face: PhotoWire | null };

/** PUT v1/tenant/photo/{kind} → `PhotoWire`. */
export type ActivatePhotoWire = { uploadId: string; clientMutationId: string };

// ---------- entitlement ----------

export type EntitlementWire = {
  tier: 'free' | 'premium';
  productId: string | null;
  platform: 'apple' | 'google' | null;
  expiresAt: string | null;
  credits: {
    monthlyAllowance: number;
    allowanceRemaining: number;
    packRemaining: number;
    /** What the user can spend now: allowance + packs. */
    totalRemaining: number;
    resetsAt: string | null;
  };
  itemRecognition: { limit: number | null; used: number; remaining: number | null };
  /** Store state of the subscription (null = free / legacy row). */
  state?: 'active' | 'gracePeriod' | 'billingRetry' | 'expired' | 'revoked' | 'pending' | null;
  /** UUID passed to StoreKit (appAccountToken) / Play Billing (obfuscatedAccountId) so purchases map to this account. */
  storeAccountToken?: string | null;
  /** Temporary self-serve premium (until store purchases are live): the switch and whether this account holds it. Older servers omit it. */
  selfServePremium?: { enabled: boolean; active: boolean } | null;
};

/** `POST v1/tenant/entitlement/purchase`. Apple: signedTransaction = StoreKit 2 JWS; Google: transactionId = purchaseToken. */
export type PurchaseRequestWire = {
  platform: 'apple' | 'google';
  productId: string;
  transactionId: string;
  signedTransaction?: string;
};

/** 202 body of a purchase the store has not completed yet (Android pending / Ask to Buy). */
export type PurchasePendingWire = { code: 'purchase_pending' };

/** `POST v1/tenant/entitlement/restore`. */
export type RestoreRequestWire = {
  platform: 'apple' | 'google';
  purchases: { productId: string; transactionId: string; signedTransaction?: string }[];
};

export type RestoreResponseWire = { entitlement: EntitlementWire; restored: number; ownedByAnotherAccount: number };

function startOfNextMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

/** Billing period of the store product behind the membership (`…premium.yearly` / `…premium.monthly`). */
export function planOfProduct(productId: string | null): Entitlement['plan'] {
  if (!productId) return undefined;
  if (/year|annual/i.test(productId)) return 'yearly';
  if (/month/i.test(productId)) return 'monthly';
  return undefined;
}

export function toEntitlement(wire: EntitlementWire): Entitlement {
  const plan = wire.tier === 'premium' ? planOfProduct(wire.productId) : undefined;
  return {
    tier: wire.tier === 'premium' ? 'member' : 'free',
    ...(plan ? { plan } : {}),
    credits: {
      monthlyAllowance: wire.credits.monthlyAllowance,
      remaining: wire.credits.totalRemaining,
      // Null for an account without a subscription period; the calendar month is the app's neutral fallback.
      resetsAt: wire.credits.resetsAt ?? startOfNextMonth(),
    },
    itemRecognition: wire.itemRecognition,
    storeAccountToken: wire.storeAccountToken ?? null,
    inGracePeriod: wire.state === 'gracePeriod',
    selfServePremium: { enabled: wire.selfServePremium?.enabled ?? false, active: wire.selfServePremium?.active ?? false },
  };
}

// ---------- jobs ----------

export type JobKindWire =
  | 'itemProcess'
  | 'itemSplit'
  | 'stylistOutfit'
  | 'stylistWeek'
  | 'stylistPack'
  | 'stylistComplete'
  | 'tryOn'
  | 'palette';
export type JobStatusWire = 'queued' | 'processing' | 'completed' | 'failed';
export type JobFailureWire = 'providerError' | 'timeout' | 'guardRejected' | 'sourceDeleted' | 'noFaceDetected' | 'photoUnsuitable';

/** `result` of a try-on job that failed with `photoUnsuitable` (the server deleted that photo; no credit was used). */
export type PhotoIssueResultWire = { photoIssue: PhotoIssue; photoKind: 'body' | 'face' };
export type PhotoIssue = 'notFullBody' | 'tooDark' | 'multiplePeople' | 'blurry' | 'noFace';

/** GET v1/tenant/job/{id}, and the body (or `job` field) of every 202. */
export type JobWire<TResult = unknown> = {
  id: string;
  kind: JobKindWire;
  status: JobStatusWire;
  failure: JobFailureWire | null;
  result: TResult | null;
  createdAt: string;
  updatedAt: string;
  /** While queued / processing: expected remaining ms (null = unknown) and when to poll next (500..3000 ms). */
  etaMs?: number | null;
  retryAfterMs?: number | null;
  /** Worker stage timings in ms (internal diagnostics; not shown in the UI). */
  timings?: Record<string, number> | null;
};

const JOB_KINDS: Record<JobKindWire, JobKind> = {
  itemProcess: 'item-process',
  itemSplit: 'item-process',
  stylistOutfit: 'stylist-outfit',
  stylistWeek: 'stylist-week',
  stylistPack: 'trip-pack',
  stylistComplete: 'stylist-complete',
  tryOn: 'tryon',
  palette: 'palette',
};

const JOB_STATUS: Record<JobStatusWire, JobStatus> = {
  queued: 'queued',
  processing: 'running',
  completed: 'done',
  failed: 'failed',
};

/** App error codes of a failed job (i18n keys / switch values), from the wire `failure`. */
const JOB_FAILURE_CODES: Record<JobFailureWire, string> = {
  providerError: 'generation_failed',
  timeout: 'generation_timeout',
  guardRejected: 'guard_rejected',
  sourceDeleted: 'source_deleted',
  noFaceDetected: 'no_face_detected',
  photoUnsuitable: 'photo_unsuitable',
};

const PHOTO_ISSUES: readonly PhotoIssue[] = ['notFullBody', 'tooDark', 'multiplePeople', 'blurry', 'noFace'];

/** The photo problem a `photoUnsuitable` failure names (unknown values read as `notFullBody` for body, `noFace` for face). */
export function toPhotoIssue(result: unknown): { issue: PhotoIssue; kind: 'body' | 'face' } | null {
  if (!result || typeof result !== 'object') return null;
  const wire = result as Partial<PhotoIssueResultWire>;
  const kind = wire.photoKind === 'face' ? 'face' : 'body';
  const issue = PHOTO_ISSUES.find((i) => i === wire.photoIssue) ?? (kind === 'face' ? 'noFace' : 'notFullBody');
  return { issue, kind };
}

/**
 * Wire job → app job. `mapResult` converts the kind-specific result (ids only on the wire) into the
 * shape the screen renders; it may read other endpoints (items, products), hence async.
 * A failed image job always has its reserved credit refunded by the server (docs §7).
 */
export async function toJob<T>(
  wire: JobWire,
  mapResult?: (result: unknown, job: JobWire) => T | Promise<T>,
): Promise<Job<T>> {
  const status = JOB_STATUS[wire.status] ?? 'running';
  let result: T | null = null;
  if (status === 'done' && wire.result !== null && wire.result !== undefined) {
    result = mapResult ? await mapResult(wire.result, wire) : (wire.result as T);
  }
  return {
    id: wire.id,
    kind: JOB_KINDS[wire.kind] ?? 'item-process',
    status,
    progress: null,
    result,
    retryAfterMs: status === 'queued' || status === 'running' ? (wire.retryAfterMs ?? null) : null,
    error:
      status === 'failed'
        ? {
            code: wire.failure ? (JOB_FAILURE_CODES[wire.failure] ?? 'generation_failed') : 'generation_failed',
            creditRefunded: true,
            ...(wire.failure === 'photoUnsuitable' ? { photo: toPhotoIssue(wire.result) } : {}),
          }
        : null,
  };
}
