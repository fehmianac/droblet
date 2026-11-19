import type { LookSlot } from '@/api/contracts/looks';
import type { TryOnResult } from '@/api/contracts/tryon';
import { currentTryOn } from '@/features/tryon/api';
import { matchesPhotoKey, tryOnPhotoKey } from '@/features/tryon/photoKey';
import { tryOnRuns } from '@/features/tryon/runs';

import { decideLookTryOn, heroTiles } from './LookHero';

const result = (source?: 'body' | 'face'): TryOnResult => ({
  tryOnId: 'img_1',
  target: { kind: 'look', id: 'l1' },
  imageUrl: 'https://img.test/1.jpg',
  creditsRemaining: null,
  ...(source ? { source } : {}),
});

describe('try-on photo key (stale-photo rule)', () => {
  const photos = (body: string | null, face: string | null) => ({
    body: body ? [{ photoId: body, url: null }] : [],
    face: face ? { photoId: face, url: null } : null,
    generatedImageCount: null,
  });

  it('is the full-length photo when there is one, else face + body type, null when neither path is complete', () => {
    expect(tryOnPhotoKey(undefined, 'hourglass')).toBeUndefined();
    expect(tryOnPhotoKey(photos('b1', 'f1'), null)).toBe('body:b1');
    expect(tryOnPhotoKey(photos(null, 'f1'), 'hourglass')).toBe('face:f1:hourglass');
    expect(tryOnPhotoKey(photos(null, 'f1'), null)).toBeNull();
    expect(tryOnPhotoKey(photos(null, 'f1'), undefined)).toBeUndefined();
    expect(tryOnPhotoKey(photos(null, null), 'hourglass')).toBeNull();
  });

  it('a new photo is a new key, so the existing-image check asks again', () => {
    expect(tryOnPhotoKey(photos('b1', null), null)).not.toBe(tryOnPhotoKey(photos('b2', null), null));
    expect(tryOnPhotoKey(photos(null, 'f1'), 'pear')).not.toBe(tryOnPhotoKey(photos(null, 'f1'), 'hourglass'));
  });

  it('an image only matches the picture path it was made on (absent source = body)', () => {
    expect(matchesPhotoKey(result('body'), 'body:b1')).toBe(true);
    expect(matchesPhotoKey(result(), 'body:b1')).toBe(true);
    expect(matchesPhotoKey(result('face'), 'body:b1')).toBe(false);
    expect(matchesPhotoKey(result('body'), 'face:f1:pear')).toBe(false);
    expect(matchesPhotoKey(result('face'), 'face:f1:pear')).toBe(true);
    expect(matchesPhotoKey(result('body'), null)).toBe(false);
  });

  it('currentTryOn: no usable picture or another path → no image; unknown stays unknown', () => {
    expect(currentTryOn(result('body'), null)).toBeNull();
    expect(currentTryOn(result('face'), 'body:b1')).toBeNull();
    expect(currentTryOn(result('body'), 'body:b1')?.tryOnId).toBe('img_1');
    expect(currentTryOn(undefined, 'body:b1')).toBeUndefined();
  });
});

describe('14b hero state', () => {
  it('generating wins; else an image with a URL; else none', () => {
    expect(decideLookTryOn({ generating: true, image: result('body') }).state).toBe('generating');
    const withImage = decideLookTryOn({ generating: false, image: result('body') });
    expect(withImage.state).toBe('image');
    expect(withImage.cachedJobId).toBe('img:img_1');
    expect(decideLookTryOn({ generating: false, image: { ...result('body'), imageUrl: null } }).state).toBe('none');
    expect(decideLookTryOn({ generating: false, image: null }).state).toBe('none');
  });

  it('pieces column: all up to 4, else 3 + "+N"', () => {
    const slots = (n: number) => Array.from({ length: n }, (_, i) => ({ slot: `s${i}` }) as unknown as LookSlot);
    expect(heroTiles(slots(3))).toEqual({ shown: slots(3), more: 0 });
    expect(heroTiles(slots(4)).shown).toHaveLength(4);
    expect(heroTiles(slots(6))).toEqual({ shown: slots(3), more: 3 });
  });

  it('runs: only real jobs are recorded, and a run clears only itself', () => {
    tryOnRuns.reset();
    const target = { kind: 'look' as const, id: 'l1' };
    tryOnRuns.record(target, 'img:abc');
    expect(tryOnRuns.get(target)).toBeNull();
    tryOnRuns.record(target, 'job_1');
    tryOnRuns.clear(target, 'job_other');
    expect(tryOnRuns.get(target)).toBe('job_1');
    tryOnRuns.clear(target, 'job_1');
    expect(tryOnRuns.get(target)).toBeNull();
  });
});
