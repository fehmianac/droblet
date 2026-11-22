/**
 * Where every picture of the app gets its URL, expo-image cache key and refresh-on-expiry from.
 *
 * - Wardrobe pieces (`ItemDto` and everything derived from it): `thumbUrl` in lists / tiles, `mediumUrl` on the
 *   item detail, `imageUrl` only in the full-screen viewer; cache key `${imageCacheKey}:<size>`. Public CDN URLs
 *   never expire; presigned fallback URLs (`imageUrlExpiresAt` set) re-fetch the wardrobe once on a load error.
 * - Private images (stay presigned): try-on images (`tryon:{id}`, fresh URL from `GET v1/tenant/tryon/{id}`),
 *   body / face photos (`photo:{id}`, re-fetch the photo list), look covers (`look-cover:{lookId}`, re-fetch the
 *   looks).
 */
import type { QueryKey } from '@tanstack/react-query';

import { pickImage, refreshImageQueries, type ImageSize, type ImageSource, type ImageVariants } from '@/lib/images';

import { requestTryOnImage } from './wire/tryon';

/** Same keys as `wardrobeKeys.items`, `lookKeys.looks`, `accountKeys.photos` (prefixes: details refetch too). */
export const IMAGE_QUERY_KEYS = {
  items: ['tenant', 'item'] as const,
  looks: ['tenant', 'look'] as const,
  photos: ['tenant', 'photo', 'list'] as const,
};

const NONE: ImageSource = { uri: null, cacheKey: null };

/** Re-fetches the wardrobe (and the looks whose slots carry its URLs) after a presigned item URL expired. */
export function refreshItemImages(ownerKeys: readonly QueryKey[] = []): Promise<void> {
  return refreshImageQueries([IMAGE_QUERY_KEYS.items, IMAGE_QUERY_KEYS.looks, ...ownerKeys]);
}

export type ItemImageLike = ImageVariants & { useOriginalImage?: boolean; originalImageUrl?: string | null };

/**
 * A wardrobe piece's picture at a size (`thumb` lists / tiles, `medium` the item detail, `full` the viewer).
 * Records from older servers (only `imageUrl`) and local previews (a `file://` URI, no cache key) fall back to
 * `imageUrl`. `ownerKeys`: the query the record came from when it is not the wardrobe (palette mismatch, a
 * trip, a stylist job…) — refreshed with the wardrobe after a presigned URL expired.
 */
export function itemImageSource(item: ItemImageLike | null | undefined, size: ImageSize, ownerKeys: readonly QueryKey[] = []): ImageSource {
  if (!item) return NONE;
  // A local choice the server has not answered yet ("Orijinale dön" while offline): that picture as it is.
  if (item.useOriginalImage && item.originalImageUrl && item.originalImageUrl !== item.imageUrl) {
    return { uri: item.originalImageUrl, cacheKey: null };
  }
  const picked = pickImage(item, size);
  return picked.uri && item.imageUrlExpiresAt ? { ...picked, onExpired: () => refreshItemImages(ownerKeys) } : picked;
}

/** A try-on image (`TryOnResult`): keyed by its id; an expired URL asks `GET v1/tenant/tryon/{id}` for a fresh one. */
export function tryOnImageSource(image: { tryOnId?: string | null; imageUrl: string | null } | null | undefined): ImageSource {
  const uri = image?.imageUrl ?? null;
  if (!uri) return NONE;
  const id = image?.tryOnId || null;
  if (!id) return { uri, cacheKey: null };
  return { uri, cacheKey: `tryon:${id}`, onExpired: async () => (await requestTryOnImage(id)).imageUrl };
}

/** A body / face photo (`PhotoMeta`): keyed by its id; an expired URL re-fetches the photo list. */
export function photoImageSource(photo: { photoId: string; url: string | null } | null | undefined): ImageSource {
  if (!photo?.url) return NONE;
  return { uri: photo.url, cacheKey: `photo:${photo.photoId}`, onExpired: () => refreshImageQueries([IMAGE_QUERY_KEYS.photos]) };
}

/**
 * A look's cover (an imported look's photo, or the AI flat-lay of its pieces): keyed by the look id and the object's
 * path, so a regenerated cover (new pieces → new object) is not served from the old cache entry while the signature of
 * the same object may change freely. An expired URL re-fetches the looks.
 */
export function lookCoverSource(look: { id: string; coverImageUrl?: string | null } | null | undefined): ImageSource {
  if (!look?.coverImageUrl) return NONE;
  const path = look.coverImageUrl.split('?')[0]?.split('/').pop() ?? '';
  return { uri: look.coverImageUrl, cacheKey: `look-cover:${look.id}:${path}`, onExpired: () => refreshImageQueries([IMAGE_QUERY_KEYS.looks]) };
}

/** A wardrobe piece in the full-screen viewer: the full image, its key and refresh, the cached thumb as preview. */
export type ViewerSource = {
  uri: string;
  cacheKey: string | null;
  onExpired?: ImageSource['onExpired'];
  preview: { uri: string; cacheKey: string | null } | null;
};

export function itemViewerSource(item: ItemImageLike | null | undefined, previewSize: Exclude<ImageSize, 'full'> = 'thumb'): ViewerSource | null {
  const full = itemImageSource(item, 'full');
  if (!full.uri) return null;
  const thumb = itemImageSource(item, previewSize);
  return {
    uri: full.uri,
    cacheKey: full.cacheKey,
    onExpired: full.onExpired,
    preview: thumb.uri && thumb.uri !== full.uri ? { uri: thumb.uri, cacheKey: thumb.cacheKey } : null,
  };
}

/** A private image (try-on, photo, cover) in the viewer: same URL, key and refresh as its tile. */
export function viewerSourceOf(source: ImageSource): ViewerSource | null {
  return source.uri ? { uri: source.uri, cacheKey: source.cacheKey, onExpired: source.onExpired, preview: null } : null;
}
