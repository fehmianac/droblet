import { QueryClient } from '@tanstack/react-query';

import { accountKeys } from '@/features/account/queries';
import { lookKeys } from '@/features/looks/queries';
import { wardrobeKeys } from '@/features/wardrobe/queries';
import { resetImageRefreshThrottle } from '@/lib/images';
import { setActiveQueryClient } from '@/sync/activeClient';

import {
  IMAGE_QUERY_KEYS,
  itemImageSource,
  itemViewerSource,
  lookCoverSource,
  photoImageSource,
  tryOnImageSource,
  viewerSourceOf,
} from './imageSources';

const mockRequest = jest.fn();
jest.mock('./wire/tryon', () => ({ requestTryOnImage: (id: string) => mockRequest(id) }));

const cdnItem = {
  imageUrl: 'https://cdn/i/full.webp',
  thumbUrl: 'https://cdn/i/256.webp',
  mediumUrl: 'https://cdn/i/768.webp',
  imageCacheKey: 'item:1:v2',
  imageUrlExpiresAt: null,
};
const presignedItem = {
  imageUrl: 'https://s3/i/full.webp?sig=1',
  thumbUrl: 'https://s3/i/full.webp?sig=1',
  mediumUrl: 'https://s3/i/full.webp?sig=1',
  imageCacheKey: 'item:1:v2',
  imageUrlExpiresAt: '2026-11-20T10:05:00Z',
};

let client: QueryClient;
beforeEach(() => {
  mockRequest.mockReset();
  resetImageRefreshThrottle();
  client = new QueryClient();
  setActiveQueryClient(client);
});
afterEach(() => {
  setActiveQueryClient(null);
  client.clear();
});

describe('image sources', () => {
  it('refreshes the same queries the screens read', () => {
    expect(IMAGE_QUERY_KEYS.items).toEqual(wardrobeKeys.items);
    expect(IMAGE_QUERY_KEYS.looks).toEqual(lookKeys.looks);
    expect(IMAGE_QUERY_KEYS.photos).toEqual(accountKeys.photos);
  });

  it('item: public CDN URLs never refresh; presigned fallback URLs re-fetch the wardrobe once', async () => {
    const cdn = itemImageSource(cdnItem, 'thumb');
    expect(cdn).toEqual({ uri: 'https://cdn/i/256.webp', cacheKey: 'item:1:v2:256' });
    expect(itemImageSource(cdnItem, 'medium').uri).toBe('https://cdn/i/768.webp');

    const presigned = itemImageSource(presignedItem, 'thumb');
    expect(presigned.cacheKey).toBe('item:1:v2:256');
    const spy = jest.spyOn(client, 'invalidateQueries');
    await presigned.onExpired?.();
    expect(spy).toHaveBeenCalledWith({ queryKey: ['tenant', 'item'] }, { cancelRefetch: false });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['tenant', 'look'] }, { cancelRefetch: false });

    // A record from another query refreshes that query too.
    resetImageRefreshThrottle();
    spy.mockClear();
    await itemImageSource(presignedItem, 'thumb', [['tenant', 'palette', 'mismatch']]).onExpired?.();
    expect(spy).toHaveBeenCalledWith({ queryKey: ['tenant', 'palette', 'mismatch'] }, { cancelRefetch: false });
  });

  it('item: an older server / a local preview has no cache key; a local "original" choice shows as it is', () => {
    expect(itemImageSource({ imageUrl: 'file:///preview.jpg' }, 'thumb')).toEqual({ uri: 'file:///preview.jpg', cacheKey: null });
    expect(itemImageSource(null, 'thumb')).toEqual({ uri: null, cacheKey: null });
    expect(itemImageSource({ ...cdnItem, useOriginalImage: true, originalImageUrl: 'file:///orig.jpg' }, 'thumb')).toEqual({ uri: 'file:///orig.jpg', cacheKey: null });
    // The server's answer for "original" (the same URL in both fields) uses the variants.
    expect(itemImageSource({ ...cdnItem, useOriginalImage: true, originalImageUrl: cdnItem.imageUrl }, 'thumb').cacheKey).toBe('item:1:v2:256');
  });

  it('viewer: the full image, with the cached smaller variant as preview', () => {
    expect(itemViewerSource(cdnItem)).toEqual({
      uri: 'https://cdn/i/full.webp',
      cacheKey: 'item:1:v2:full',
      onExpired: undefined,
      preview: { uri: 'https://cdn/i/256.webp', cacheKey: 'item:1:v2:256' },
    });
    expect(itemViewerSource(cdnItem, 'medium')?.preview?.uri).toBe('https://cdn/i/768.webp');
    // Fallback mode: thumb == full → no separate preview.
    expect(itemViewerSource(presignedItem)?.preview).toBeNull();
    expect(itemViewerSource({ imageUrl: null })).toBeNull();
  });

  it('try-on: keyed by the image id; an expired URL asks GET v1/tenant/tryon/{id} for a fresh one', async () => {
    mockRequest.mockResolvedValueOnce({ imageUrl: 'https://s3/tryon/fresh.webp' });
    const source = tryOnImageSource({ tryOnId: 'img1', imageUrl: 'https://s3/tryon/old.webp' });
    expect(source).toMatchObject({ uri: 'https://s3/tryon/old.webp', cacheKey: 'tryon:img1' });
    await expect(source.onExpired?.()).resolves.toBe('https://s3/tryon/fresh.webp');
    expect(mockRequest).toHaveBeenCalledWith('img1');
    expect(tryOnImageSource({ tryOnId: '', imageUrl: 'https://x' })).toEqual({ uri: 'https://x', cacheKey: null });
    expect(tryOnImageSource(null)).toEqual({ uri: null, cacheKey: null });
    expect(viewerSourceOf(source)).toMatchObject({ uri: 'https://s3/tryon/old.webp', cacheKey: 'tryon:img1', preview: null });
  });

  it('photos and look covers: keyed by id, refresh their own query', async () => {
    const spy = jest.spyOn(client, 'invalidateQueries');
    const photo = photoImageSource({ photoId: 'p1', url: 'https://s3/photo.jpg' });
    expect(photo).toMatchObject({ uri: 'https://s3/photo.jpg', cacheKey: 'photo:p1' });
    await photo.onExpired?.();
    expect(spy).toHaveBeenCalledWith({ queryKey: ['tenant', 'photo', 'list'] }, { cancelRefetch: false });
    expect(photoImageSource({ photoId: 'p1', url: null })).toEqual({ uri: null, cacheKey: null });

    const cover = lookCoverSource({ id: 'L1', coverImageUrl: 'https://s3/cover.jpg' });
    expect(cover).toMatchObject({ uri: 'https://s3/cover.jpg', cacheKey: 'look-cover:L1:cover.jpg' });
    await cover.onExpired?.();
    expect(spy).toHaveBeenCalledWith({ queryKey: ['tenant', 'look'] }, { cancelRefetch: false });
    expect(lookCoverSource({ id: 'L1' })).toEqual({ uri: null, cacheKey: null });
  });
});
