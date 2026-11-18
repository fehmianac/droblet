/**
 * Wire shapes of "Üzerimde gör" (docs/api/wardrobe-looks-plan-stylist.md §7) and the mapping between
 * the app's try-on targets and the wire targets.
 */
import { apiRequest } from '../client';
import { queryString } from '../dataSource';
import type { TryOnResult, TryOnTarget } from '../contracts/tryon';
import { ApiError } from '../errors';
import type { JobWire } from './core';

export type TryOnTargetKindWire = 'item' | 'look' | 'product' | 'editLook' | 'suggestion' | 'tripDay';
/** `id`: item / look / product / edit look id; for `suggestion` the stylist job id with `index`; for `tripDay` `{tripId}/{yyyy-MM-dd}`. */
export type TryOnTargetWire = { kind: TryOnTargetKindWire; id: string; index: number | null };

export type TryOnImageWire = { id: string; url: string; urlExpiresAt: string; createdAt: string };

/** POST v1/tenant/tryon → 200 (`cached`, no credit) | 202 (`queued`, job result `{ tryOnImageId }`). */
export type TryOnStartWire = { status: 'cached' | 'queued'; image: TryOnImageWire | null; job: JobWire | null };

/** Result of a `tryOn` job. */
export type TryOnJobResultWire = { tryOnImageId: string };

/** Pseudo job id of an image that already existed (`POST v1/tenant/tryon` → 200): nothing to poll. */
const CACHED_PREFIX = 'img:';

export function cachedTryOnJobId(imageId: string): string {
  return `${CACHED_PREFIX}${imageId}`;
}

/** The image id behind a pseudo job id, or null for a real job id. */
export function cachedTryOnImageId(jobId: string | null | undefined): string | null {
  return jobId && jobId.startsWith(CACHED_PREFIX) ? jobId.slice(CACHED_PREFIX.length) : null;
}

type PlanDayLookWire = { date: string; lookId: string | null };

/**
 * App target → wire target. A planned day resolves to the look planned for it (one extra read);
 * a trip day (`{tripId}:{date}`) is the `tripDay` target `{tripId}/{date}`: the server renders the
 * day's pieces with the common job and cache (same outfit = same image, no second credit).
 */
export async function toWireTarget(target: TryOnTarget): Promise<TryOnTargetWire> {
  switch (target.kind) {
    case 'item':
    case 'look':
    case 'product':
      return { kind: target.kind, id: target.id, index: null };
    case 'edit-look':
      return { kind: 'editLook', id: target.id, index: null };
    case 'suggestion': {
      const cut = target.id.lastIndexOf(':');
      const index = cut >= 0 ? Number(target.id.slice(cut + 1)) : Number.NaN;
      if (cut <= 0 || !Number.isInteger(index) || index < 0) {
        throw new ApiError('http', 400, { code: 'target_index_invalid', status: 400 });
      }
      return { kind: 'suggestion', id: target.id.slice(0, cut), index };
    }
    case 'plan-day': {
      const days = await apiRequest<PlanDayLookWire[]>(`v1/tenant/plan-day${queryString({ from: target.id, to: target.id })}`);
      const lookId = days.find((d) => d.date === target.id)?.lookId;
      if (!lookId) throw new ApiError('http', 404, { code: 'target_not_found', status: 404 });
      return { kind: 'look', id: lookId, index: null };
    }
    case 'trip-day': {
      const cut = target.id.lastIndexOf(':');
      const date = target.id.slice(cut + 1);
      if (cut <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new ApiError('http', 400, { code: 'target_id_invalid', status: 400 });
      }
      return { kind: 'tripDay', id: `${target.id.slice(0, cut)}/${date}`, index: null };
    }
    default:
      throw new ApiError('http', 422, { code: 'tryon_target_unsupported', status: 422 });
  }
}

export function toTryOnResult(image: TryOnImageWire, target: TryOnTarget | null): TryOnResult {
  return {
    tryOnId: image.id,
    target: target ?? { kind: 'look', id: '' },
    imageUrl: image.url,
    creditsRemaining: null,
  };
}

/** GET v1/tenant/tryon/{id} — a fresh presigned URL (never cache it beyond `urlExpiresAt`). */
export async function requestTryOnImage(imageId: string, target: TryOnTarget | null = null): Promise<TryOnResult> {
  return toTryOnResult(await apiRequest<TryOnImageWire>(`v1/tenant/tryon/${encodeURIComponent(imageId)}`), target);
}

/** `mapResult` of a try-on job: `{ tryOnImageId }` → the image. */
export function mapTryOnResult(result: unknown): Promise<TryOnResult> {
  return requestTryOnImage((result as TryOnJobResultWire).tryOnImageId);
}

/** GET v1/tenant/tryon?kind=&id=&index= — the existing image of a target, generating nothing. Null on 404. */
export async function requestExistingTryOn(target: TryOnTarget): Promise<TryOnResult | null> {
  try {
    const wire = await toWireTarget(target);
    const image = await apiRequest<TryOnImageWire>(`v1/tenant/tryon${queryString({ kind: wire.kind, id: wire.id, index: wire.index })}`);
    return toTryOnResult(image, target);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.code === 'tryon_target_unsupported')) return null;
    throw e;
  }
}

// ---------- the planned week (07 → 07b) ----------

/** POST v1/tenant/tryon/plan-week/quote `{ weekStart }` → 200, charges nothing. Days without a look are not listed. */
export type TryOnWeekQuoteWire = {
  weekStart: string;
  requiredCredits: number;
  cachedCount: number;
  remainingCredits: number | null;
  sufficient: boolean;
  items: { date: string; lookId: string; cached: boolean; tryOnImageId: string | null }[];
};

/**
 * POST v1/tenant/tryon/plan-week `{ requestId, weekStart, expectedCredits }` → 202. All or nothing:
 * 409 `credit_quote_changed` (re-quote), 402 `credits_exhausted`, 403 `premium_required`, 422 `body_photo_required`.
 */
export type TryOnWeekStartWire = {
  chargedCredits: number;
  items: { date: string; lookId: string; status: 'cached' | 'queued'; image: TryOnImageWire | null; job: JobWire | null }[];
};

/** What the 07b sheet shows: the credits this week costs (cached days are free). */
export type TryOnWeekQuote = { weekStart: string; requiredCredits: number; cachedCount: number; dates: string[] };

export function toWeekQuote(wire: TryOnWeekQuoteWire): TryOnWeekQuote {
  return { weekStart: wire.weekStart, requiredCredits: wire.requiredCredits, cachedCount: wire.cachedCount, dates: wire.items.map((i) => i.date) };
}

/** Day → job id to follow (a cached image becomes its pseudo job id, resolved without polling). */
export function toWeekJobs(wire: TryOnWeekStartWire): Record<string, string> {
  const jobs: Record<string, string> = {};
  for (const item of wire.items) {
    if (item.job) jobs[item.date] = item.job.id;
    else if (item.image) jobs[item.date] = cachedTryOnJobId(item.image.id);
  }
  return jobs;
}

export const CREDIT_QUOTE_CHANGED = 'credit_quote_changed';
