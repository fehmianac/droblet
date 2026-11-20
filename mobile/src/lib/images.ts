import type { QueryKey } from '@tanstack/react-query';

import { getActiveQueryClient } from '@/sync/activeClient';

/**
 * Image variants of a wardrobe piece (`ItemDto`). Every field is optional: older servers send only `imageUrl`
 * (+ `imageUrlExpiresAt`), so `undefined` reads as null.
 *
 * - `thumbUrl` — 256 px longest side (lists, grids, tiles, small slots);
 * - `mediumUrl` — 768 px (item detail, medium heroes);
 * - `imageUrl` — full size (only the full-screen viewer);
 * - `imageCacheKey` — stable for the same image version across fetches (changes when the image changes);
 * - `imageUrlExpiresAt` — null when the URLs are public CDN URLs; set when they are presigned (fallback mode).
 */
export type ImageVariants = {
  imageUrl?: string | null;
  thumbUrl?: string | null;
  mediumUrl?: string | null;
  imageCacheKey?: string | null;
  imageUrlExpiresAt?: string | null;
};

export type ImageSize = 'thumb' | 'medium' | 'full';

/**
 * Called once when a picture fails to load (an expired presigned URL). It may answer a fresh URL (try-on:
 * `GET v1/tenant/tryon/{id}`), or nothing when the owner re-renders with new props (an invalidated query).
 */
export type ImageRefresh = () => Promise<string | null | void> | string | null | void;

/** What `ImageSlot` / `ItemThumb` / the viewer take: spread it (`<ImageSlot {...source} />`). */
export type ImageSource = { uri: string | null; cacheKey: string | null; onExpired?: ImageRefresh };

/** Cache-key suffix of each variant (`${imageCacheKey}:256` …). */
export const IMAGE_SIZE_SUFFIX: Record<ImageSize, string> = { thumb: '256', medium: '768', full: 'full' };

const FIELD: Record<ImageSize, 'thumbUrl' | 'mediumUrl' | 'imageUrl'> = { thumb: 'thumbUrl', medium: 'mediumUrl', full: 'imageUrl' };

/** Which variants may stand in for a size, best first: a smaller one is never upscaled into a bigger slot. */
const FALLBACK: Record<ImageSize, readonly ImageSize[]> = {
  thumb: ['thumb', 'medium', 'full'],
  medium: ['medium', 'full'],
  full: ['full'],
};

/**
 * The URL + expo-image cache key for a size: thumb → medium → full fallback. The key carries the suffix of the
 * variant actually used, so a presigned URL (whose signature changes on every fetch) still hits the disk cache.
 */
export function pickImage(src: ImageVariants | null | undefined, size: ImageSize): ImageSource {
  if (!src) return { uri: null, cacheKey: null };
  for (const variant of FALLBACK[size]) {
    const uri = src[FIELD[variant]];
    if (uri) return { uri, cacheKey: src.imageCacheKey ? `${src.imageCacheKey}:${IMAGE_SIZE_SUFFIX[variant]}` : null };
  }
  return { uri: null, cacheKey: null };
}

/**
 * The variant fields of a record to copy onto another one (a look slot, a trip / stylist piece). Only the fields
 * that carry a value: a record from an older server keeps its old shape.
 */
export function imageVariantsOf(src: ImageVariants | null | undefined): Omit<ImageVariants, 'imageUrl'> {
  const out: Omit<ImageVariants, 'imageUrl'> = {};
  if (src?.thumbUrl) out.thumbUrl = src.thumbUrl;
  if (src?.mediumUrl) out.mediumUrl = src.mediumUrl;
  if (src?.imageCacheKey) out.imageCacheKey = src.imageCacheKey;
  if (src?.imageUrlExpiresAt) out.imageUrlExpiresAt = src.imageUrlExpiresAt;
  return out;
}

/** A burst of failed tiles (a whole grid after the URLs expired) refreshes each query once in this window. */
export const IMAGE_REFRESH_WINDOW_MS = 20_000;
const lastRefresh = new Map<string, number>();

/**
 * Re-fetches the queries that own expired image URLs (throttled per key, never cancelling a fetch in flight).
 * Answers nothing: the screens re-render with the fresh URLs.
 */
export async function refreshImageQueries(keys: readonly QueryKey[], now: number = Date.now()): Promise<void> {
  const client = getActiveQueryClient();
  if (!client) return;
  const due = keys.filter((key) => {
    const hash = JSON.stringify(key);
    const last = lastRefresh.get(hash);
    if (last !== undefined && now - last < IMAGE_REFRESH_WINDOW_MS) return false;
    lastRefresh.set(hash, now);
    return true;
  });
  await Promise.all(due.map((queryKey) => client.invalidateQueries({ queryKey }, { cancelRefetch: false })));
}

/** Tests only. */
export function resetImageRefreshThrottle(): void {
  lastRefresh.clear();
}
