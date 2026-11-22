import type { Look } from '@/api/contracts/looks';
import { ApiError } from '@/api/errors';

import { feedShareErrorKey, withFeedShare } from './mutations';

const look: Look = {
  id: 'l1',
  name: 'Desenli kazak',
  occasion: 'weekend',
  slots: [],
  isFavorite: false,
  rating: null,
  ratingCount: 0,
  tryOnImageUrl: null,
  createdAt: '2026-11-18T09:00:00Z',
  baseVersion: 1,
};

const refusal = (status: number, code: string | null) => new ApiError('http', status, code ? { status, code } : null);

describe('"Akışta paylaş" (Akış F2)', () => {
  it('names each server refusal; anything else is the plain "could not" of the direction', () => {
    expect(feedShareErrorKey(refusal(422, 'email_not_verified'), true)).toBe('email_not_verified');
    expect(feedShareErrorKey(refusal(422, 'handle_required'), true)).toBe('handle_required');
    expect(feedShareErrorKey(refusal(422, 'look_not_shareable'), true)).toBe('look_not_shareable');
    expect(feedShareErrorKey(refusal(403, 'teen_restricted'), true)).toBe('teen_restricted');
    expect(feedShareErrorKey(refusal(429, 'too_many_attempts'), true)).toBe('too_many_attempts');
    expect(feedShareErrorKey(refusal(429, null), true)).toBe('too_many_attempts');
    expect(feedShareErrorKey(refusal(500, null), true)).toBe('shareFailed');
    expect(feedShareErrorKey(refusal(500, null), false)).toBe('removeFailed');
    expect(feedShareErrorKey(new Error('x'), true)).toBe('shareFailed');
  });

  it('on starts the numbers at zero (or keeps them); off drops them', () => {
    expect(withFeedShare(look, true)).toMatchObject({ sharedToFeed: true, feedStats: { likeCount: 0, saveCount: 0 } });
    expect(withFeedShare({ ...look, feedStats: { likeCount: 38, saveCount: 12 } }, true).feedStats).toEqual({ likeCount: 38, saveCount: 12 });
    expect(withFeedShare({ ...look, sharedToFeed: true, feedStats: { likeCount: 38, saveCount: 12 } }, false)).toMatchObject({ sharedToFeed: false, feedStats: null });
  });
});
