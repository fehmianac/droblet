/**
 * Wire shapes of "Üzerimde gör" (docs/api/wardrobe-looks-plan-stylist.md §7) and the mapping between
 * the app's try-on targets and the wire targets.
 */
import { apiRequest } from '../client';
import { queryString } from '../dataSource';
import type { TryOnResult, TryOnTarget } from '../contracts/tryon';
import { ApiError } from '../errors';
import type { JobWire } from './core';

export type TryOnTargetKindWire = 'item' | 'look' | 'product' | 'editLook' | 'suggestion';
/** `id`: item / look / product / edit look id; for `suggestion` the stylist job id with `index`. */
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
 * a trip day cannot be rendered — its outfit is a slot list of the trip, not a look the server can
 * address — and is refused here before any request.
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
