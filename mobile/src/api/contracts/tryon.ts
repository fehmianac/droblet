/**
 * E6 "Üzerimde gör" — PROVISIONAL contract (BACKEND_ENGINEER §Uç nokta haritası, E6).
 * One try-on = 1 AI credit; the same target + same body photo is served from cache without a new credit.
 */
import type { JobAccepted } from './jobs';

export type TryOnTargetKind = 'look' | 'product' | 'suggestion' | 'plan-day' | 'trip-day' | 'edit-look';

/** `suggestion` ids are `{stylistJobId}:{index}`; `plan-day` ids are the ISO date; `edit-look` ids are a weekly edit's look (08; the server's `editLook`). */
export type TryOnTarget = { kind: TryOnTargetKind; id: string };

/**
 * POST v1/tenant/tryon → 202 `JobAccepted`.
 * 422 `body_photo_required` when there is no body photo; 402/409 `monthly_limit_reached` when out of credits.
 */
export type StartTryOnRequest = { requestId: string; target: TryOnTarget };
export type StartTryOnResponse = JobAccepted;

/** Result of a `tryon` job and body of GET v1/tenant/tryon/{id}. */
export type TryOnResult = {
  tryOnId: string;
  target: TryOnTarget;
  /** Private, short-lived signed URL — owner only. */
  imageUrl: string | null;
  /** Credits left after this image. */
  creditsRemaining: number;
};

/** GET v1/tenant/tryon?kind=&id= → existing image for the target, or 404. */
export type ExistingTryOnResponse = TryOnResult;
