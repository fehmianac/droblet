import type { Look } from '@/api/contracts/looks';

import { withKnownCover } from './mutations';
import { COVER_POLL_MAX_MS, COVER_POLL_MS, coverPollInterval } from './queries';

const look = (over: Partial<Look> = {}): Look => ({
  id: 'L1',
  name: 'Ofis',
  occasion: 'office',
  slots: [
    { slot: 'top', source: 'wardrobe', refId: 'i1' } as Look['slots'][number],
    { slot: 'bottom', source: 'wardrobe', refId: 'i2' } as Look['slots'][number],
  ],
  isFavorite: false,
  rating: null,
  ratingCount: 0,
  tryOnImageUrl: null,
  createdAt: '2026-11-22T10:00:00Z',
  baseVersion: 1,
  ...over,
});

describe('coverPollInterval (21c AI flat-lay cover)', () => {
  it('polls only while a look waits for its cover, and gives up after the cap', () => {
    expect(coverPollInterval(undefined)).toBe(false);
    expect(coverPollInterval([look()])).toBe(false);
    expect(coverPollInterval([look({ coverPending: true })], 1_000)).toBe(COVER_POLL_MS);
    expect(coverPollInterval([look({ coverPending: true })], 1_000 + COVER_POLL_MAX_MS - 1)).toBe(COVER_POLL_MS);
    expect(coverPollInterval([look({ coverPending: true })], 1_000 + COVER_POLL_MAX_MS)).toBe(false);
    // Arrived: the wait is forgotten, a later regeneration polls again from zero.
    expect(coverPollInterval([look({ coverPending: true, coverImageUrl: 'https://s3/c.webp' })], 500_000)).toBe(false);
    expect(coverPollInterval([look({ coverPending: true })], 900_000)).toBe(COVER_POLL_MS);
  });
});

describe('withKnownCover', () => {
  it('keeps the cached cover when a write answers without one and the pieces are the same', () => {
    const known = look({ coverImageUrl: 'https://s3/c.webp' });
    expect(withKnownCover(look({ isFavorite: true }), known).coverImageUrl).toBe('https://s3/c.webp');
  });

  it('drops it when the pieces changed, and prefers the answer’s own cover', () => {
    const known = look({ coverImageUrl: 'https://s3/c.webp' });
    const changed = look({ slots: [...look().slots.slice(0, 1), { slot: 'bottom', source: 'wardrobe', refId: 'i9' } as Look['slots'][number]] });
    expect(withKnownCover(changed, known).coverImageUrl).toBeUndefined();
    expect(withKnownCover(look({ coverImageUrl: 'https://s3/new.webp' }), known).coverImageUrl).toBe('https://s3/new.webp');
  });
});
