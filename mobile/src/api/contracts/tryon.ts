/**
 * E6 "Üzerimde gör" — the app-side shapes (wire: docs/api/wardrobe-looks-plan-stylist.md §7, mapping in
 * `../wire/tryon`). One image = 1 AI credit; the same outfit + body photo is served from cache for free.
 */
import type { JobAccepted } from './jobs';
import type { ItemCategory } from './wardrobe';

export type TryOnTargetKind = 'item' | 'look' | 'product' | 'edit-look' | 'suggestion' | 'plan-day' | 'trip-day' | 'photo' | 'import-photo';

/**
 * App targets → wire `{ kind, id, index }`:
 * `item` / `look` / `product` as is · `edit-look` → `editLook` (id forms in the docs) · `suggestion`
 * (`{stylistJobId}:{index}`) → `suggestion` + `index` · `plan-day` (ISO date) → the `look` planned that
 * day (404 `target_not_found` when none) · `trip-day` (`{tripId}:{date}`) → `tripDay` with id
 * `{tripId}/{date}` (the day's pieces of the packed trip) · `photo` (an item upload / draft id: a photo of someone
 * wearing a whole outfit, tried on without splitting it) → `photo` · `import-photo` (`{sessionId}:{index}`, an outfit
 * import photo) → `importPhoto` + `index`.
 */
export type TryOnTarget = { kind: TryOnTargetKind; id: string };

/**
 * POST v1/tenant/tryon → 200 `{ status: "cached", image }` (no credit) or 202 `{ status: "queued", job }`.
 * The hook answers `JobAccepted` for both: a cached image gets the pseudo job id `img:{tryOnImageId}`,
 * which `useTryOnJob` resolves without polling.
 * Errors: 402 `credits_exhausted` (credit sheet), 403 `premium_required` (paywall), 404 `target_not_found`,
 * 422 `body_photo_required` / `tryon_target_empty`, 409 `request_id_reused`.
 */
export type StartTryOnRequest = { requestId: string; target: TryOnTarget };
/** A piece being rendered, in dressing order — the curtain wait lists them ("Lacivert blazer giyiliyor…"). */
export type TryOnPiece = { name: string | null; category: ItemCategory };
/** `pieces`: queued jobs only (none for a cached image or an outfit photo). */
export type StartTryOnResponse = JobAccepted & { pieces?: TryOnPiece[] };

/** Result of a `tryon` job and body of GET v1/tenant/tryon/{id}. */
export type TryOnResult = {
  tryOnId: string;
  target: TryOnTarget;
  /** Private, short-lived signed URL — owner only. */
  imageUrl: string | null;
  /** Not on the wire (the balance is `GET v1/tenant/entitlement`); null from the API. */
  creditsRemaining: number | null;
  /** `face` = made from the face photo and the chosen body type (no full-length photo): the result says so. */
  source?: 'body' | 'face';
  /** Outfit-photo try-on: the photo the outfit came from ("Kaynak fotoğraf"), private signed URL; null otherwise. */
  referenceUrl?: string | null;
};

/** GET v1/tenant/tryon?kind=&id=&index= → existing image for the target with the current body photo, or 404. */
export type ExistingTryOnResponse = TryOnResult;
