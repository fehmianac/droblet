import type { MyPhotos } from '@/api/contracts/account';
import type { TryOnResult } from '@/api/contracts/tryon';
import { useBodyProfile } from '@/api/profile';
import { useMyPhotos } from '@/features/account/queries';

/**
 * Which picture of the user a try-on is rendered on right now: the full-length photo when there is one
 * (`body:{photoId}`), else the face photo + the chosen body type (`face:{photoId}:{bodyType}`); null when
 * neither path is complete (no image can match), undefined while the photos are not known yet.
 *
 * An image made on another picture is not "the user's" any more: the key is part of the existing-image
 * check's query key, so a new photo (or body type) asks again instead of showing the old answer.
 */
export type TryOnPhotoKey = string | null | undefined;

export function tryOnPhotoKey(photos: MyPhotos | undefined, bodyType: string | null | undefined): TryOnPhotoKey {
  if (!photos) return undefined;
  const body = photos.body[0];
  if (body) return `body:${body.photoId}`;
  if (!photos.face) return null;
  if (bodyType === undefined) return undefined;
  return bodyType ? `face:${photos.face.photoId}:${bodyType}` : null;
}

/**
 * The stale-photo rule: an image only belongs to the current picture when it was made on the same path —
 * a face-path image once a full-length photo exists (or the other way round) is treated as no image.
 * `source` absent (older servers) = body.
 */
export function matchesPhotoKey(result: Pick<TryOnResult, 'source'> | null | undefined, key: TryOnPhotoKey): boolean {
  if (!result || !key) return false;
  const source = result.source ?? 'body';
  return key.startsWith(`${source}:`);
}

/** The current photo key from the cached photos and body profile (nothing new is fetched). */
export function useTryOnPhotoKey(): TryOnPhotoKey {
  const photos = useMyPhotos();
  const body = useBodyProfile();
  const bodyType = body.status === 'success' ? (body.data?.bodyType ?? null) : body.status === 'error' ? null : undefined;
  return tryOnPhotoKey(photos.data, bodyType);
}
