import { useState, type ReactNode } from 'react';

import { track } from '@/analytics/track';
import type { FeedPost } from '@/api/contracts/feed';

import { PostMenuSheet } from './PostMenuSheet';
import { SimilarSheet } from './SimilarSheet';

/**
 * The two sheets of a member's post — "⋯" (Bunu gösterme · Şikâyet et) and "Benzerlerini gör" — owned by the list
 * that shows the cards (Akış, Kaydedilenler › Akış): one instance for the whole list.
 *
 *   const userPost = useUserPostSheets({ teen });
 *   <FeedPostCard post={item} teen={teen} onBuy={setBuying} onMenu={userPost.openMenu} onSimilar={userPost.openSimilar} />
 *   {userPost.sheets}
 */
export function useUserPostSheets({ teen }: { teen: boolean }): { openMenu: (post: FeedPost) => void; openSimilar: (post: FeedPost) => void; sheets: ReactNode } {
  const [menu, setMenu] = useState<FeedPost | null>(null);
  const [similar, setSimilar] = useState<FeedPost | null>(null);
  return {
    openMenu: setMenu,
    openSimilar: (post) => {
      track('feed_similar_open', { postId: post.id });
      setSimilar(post);
    },
    sheets: (
      <>
        <PostMenuSheet post={menu} onClose={() => setMenu(null)} />
        {/* The store is closed to teen accounts. */}
        {teen ? null : <SimilarSheet post={similar} onClose={() => setSimilar(null)} />}
      </>
    ),
  };
}
