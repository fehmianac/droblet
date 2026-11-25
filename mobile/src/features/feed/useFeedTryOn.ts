import type { ReactElement } from 'react';

import { track } from '@/analytics/track';
import type { FeedPost } from '@/api/contracts/feed';
import { useTryOnAction } from '@/features/tryon/useTryOnAction';

export type FeedTryOn = {
  /** "Üzerimde dene" tapped: the intent is tracked, then the shared try-on flow (requirements, credit, job) runs. */
  start: () => void;
  /** "Çevrimdışısın…" / "Başlatılamadı…" after a tap, else null. */
  note: string | null;
  /** From the tap until the try-on screen opens: the button shows its loader. */
  starting: boolean;
  /** The credit confirmation; render it once next to the button. */
  sheet: ReactElement;
};

/** "Üzerimde dene · 1 kredi" of an editor post — the same on its card and on its detail. */
export function useFeedTryOn(post: Pick<FeedPost, 'id' | 'title'>): FeedTryOn {
  const tryOn = useTryOnAction({
    target: { kind: 'feed-post', id: post.id },
    title: post.title,
    feature: 'feed_try_on',
    // No per-post existence check (one read per card): the server answers an existing image for free.
    cachedJobId: null,
  });
  return {
    start: () => {
      track('feed_tryon_start', { source: 'post', postId: post.id });
      tryOn.invite.onPress();
    },
    note: tryOn.note,
    starting: tryOn.starting,
    sheet: tryOn.sheet,
  };
}
