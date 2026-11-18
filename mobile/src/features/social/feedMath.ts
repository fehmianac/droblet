import type { InfiniteData } from '@tanstack/react-query';

import type { FeedLook, FeedPage } from '@/api/contracts/social';

type RatingFields = Pick<FeedLook, 'myRating' | 'averageRating' | 'ratingCount'>;

/**
 * Rating summary after this user sets or changes their 1–5 rating (one rating per person per look,
 * a new one overwrites). Used for the optimistic update; the server's numbers replace it on refetch.
 */
export function applyRating(look: RatingFields, score: number): RatingFields {
  const clamped = Math.min(5, Math.max(1, Math.round(score)));
  const sum = (look.averageRating ?? 0) * look.ratingCount - (look.myRating ?? 0) + clamped;
  const ratingCount = look.myRating === null ? look.ratingCount + 1 : look.ratingCount;
  return { myRating: clamped, ratingCount, averageRating: Math.round((sum / ratingCount) * 10) / 10 };
}

/** Applies `change` to every feed look matching `match`, across all loaded pages. */
export function updateFeedLooks(
  data: InfiniteData<FeedPage> | undefined,
  match: (look: FeedLook) => boolean,
  change: (look: FeedLook) => FeedLook,
): InfiniteData<FeedPage> | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({ ...page, items: page.items.map((l) => (match(l) ? change(l) : l)) })),
  };
}

/** Share URL of a look, carrying the sharer's invite code. */
export function lookShareUrl(domain: string, lookId: string, inviteCode: string | null): string {
  const base = `https://${domain}/l/${encodeURIComponent(lookId)}`;
  return inviteCode ? `${base}?invite=${encodeURIComponent(inviteCode)}` : base;
}

/** Share URL of a profile, carrying the sharer's invite code. */
export function profileShareUrl(domain: string, handle: string, inviteCode: string | null): string {
  const base = `https://${domain}/u/${encodeURIComponent(handle)}`;
  return inviteCode ? `${base}?invite=${encodeURIComponent(inviteCode)}` : base;
}
