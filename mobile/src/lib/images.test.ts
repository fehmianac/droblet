import { QueryClient } from '@tanstack/react-query';

import { setActiveQueryClient } from '@/sync/activeClient';

import { IMAGE_REFRESH_WINDOW_MS, imageVariantsOf, pickImage, refreshImageQueries, resetImageRefreshThrottle } from './images';

const full = {
  imageUrl: 'https://cdn/i/full.webp',
  thumbUrl: 'https://cdn/i/256.webp',
  mediumUrl: 'https://cdn/i/768.webp',
  imageCacheKey: 'item:1:v2',
};

describe('pickImage — url + cache key per size', () => {
  it('picks the variant of the size, keyed `${imageCacheKey}:<size>`', () => {
    expect(pickImage(full, 'thumb')).toEqual({ uri: 'https://cdn/i/256.webp', cacheKey: 'item:1:v2:256' });
    expect(pickImage(full, 'medium')).toEqual({ uri: 'https://cdn/i/768.webp', cacheKey: 'item:1:v2:768' });
    expect(pickImage(full, 'full')).toEqual({ uri: 'https://cdn/i/full.webp', cacheKey: 'item:1:v2:full' });
  });

  it('falls back thumb → medium → full, keyed by the variant actually used', () => {
    expect(pickImage({ ...full, thumbUrl: null }, 'thumb')).toEqual({ uri: 'https://cdn/i/768.webp', cacheKey: 'item:1:v2:768' });
    expect(pickImage({ ...full, thumbUrl: null, mediumUrl: null }, 'thumb')).toEqual({ uri: 'https://cdn/i/full.webp', cacheKey: 'item:1:v2:full' });
    expect(pickImage({ ...full, mediumUrl: null }, 'medium')).toEqual({ uri: 'https://cdn/i/full.webp', cacheKey: 'item:1:v2:full' });
    // A bigger slot is never filled with a smaller variant.
    expect(pickImage({ imageCacheKey: 'k', thumbUrl: 'https://cdn/t.webp', imageUrl: null }, 'medium')).toEqual({ uri: null, cacheKey: null });
  });

  it('reads an older server (only imageUrl, fields undefined) as the full image without a cache key', () => {
    const old = { imageUrl: 'https://s3/i.jpg?X-Amz-Signature=abc', imageUrlExpiresAt: '2026-11-20T10:05:00Z' };
    expect(pickImage(old, 'thumb')).toEqual({ uri: old.imageUrl, cacheKey: null });
    expect(pickImage(old, 'medium')).toEqual({ uri: old.imageUrl, cacheKey: null });
    expect(pickImage(old, 'full')).toEqual({ uri: old.imageUrl, cacheKey: null });
  });

  it('answers nothing without a picture', () => {
    expect(pickImage(null, 'thumb')).toEqual({ uri: null, cacheKey: null });
    expect(pickImage(undefined, 'full')).toEqual({ uri: null, cacheKey: null });
    expect(pickImage({ imageUrl: null, imageCacheKey: 'k' }, 'thumb')).toEqual({ uri: null, cacheKey: null });
  });

  it('imageVariantsOf copies only the fields that carry a value', () => {
    expect(imageVariantsOf({ imageUrl: 'x' })).toEqual({});
    expect(imageVariantsOf(undefined)).toEqual({});
    expect(imageVariantsOf({ ...full, imageUrlExpiresAt: null })).toEqual({ thumbUrl: full.thumbUrl, mediumUrl: full.mediumUrl, imageCacheKey: full.imageCacheKey });
  });
});

describe('refreshImageQueries — refresh the owning queries once per burst', () => {
  let client: QueryClient;
  beforeEach(() => {
    resetImageRefreshThrottle();
    client = new QueryClient();
    setActiveQueryClient(client);
  });
  afterEach(() => {
    setActiveQueryClient(null);
    client.clear();
  });

  it('invalidates each key once inside the window, without cancelling a fetch in flight', async () => {
    const spy = jest.spyOn(client, 'invalidateQueries');
    await refreshImageQueries([['tenant', 'item'], ['tenant', 'look']], 1_000);
    await refreshImageQueries([['tenant', 'item']], 2_000);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['tenant', 'item'] }, { cancelRefetch: false });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['tenant', 'look'] }, { cancelRefetch: false });
    // After the window the next failure may refresh again.
    await refreshImageQueries([['tenant', 'item']], 1_000 + IMAGE_REFRESH_WINDOW_MS);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('does nothing without a query client (unit tests, signed out)', async () => {
    setActiveQueryClient(null);
    await expect(refreshImageQueries([['tenant', 'item']])).resolves.toBeUndefined();
  });
});
