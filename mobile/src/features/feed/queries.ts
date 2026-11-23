import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import { apiRequest } from '@/api/client';
import type { EditorStory, FeedPost, FeedPostPage, FeedTab } from '@/api/contracts/feed';
import type { ProductSummary } from '@/api/contracts/store';
import type { ProductWire } from '@/api/wire/catalog';
import { toProductSummary } from '@/api/wire/store';
import { fromSource, queryString } from '@/api/dataSource';
import { feedOccasionParam, toEditorStory, toFeedPost, toFeedPostPage, type FeedPostPageWire, type FeedPostWire, type FeedStoryWire } from '@/api/wire/feed';
import { feedFixtures } from '@/fixtures/feed';

/** Query keys of Akış F1. Posts are cached per tab; likes / saves update every cached copy of a post. */
export const feedKeys = {
  root: ['content', 'feed'] as const,
  posts: ['content', 'feed', 'post'] as const,
  postsOf: (tab: FeedTab) => ['content', 'feed', 'post', tab] as const,
  stories: ['content', 'feed', 'story'] as const,
  saved: ['tenant', 'feed-post', 'saved'] as const,
  similar: (postId: string) => ['tenant', 'feed-post', 'similar', postId] as const,
  /**
   * The post whose detail was opened last (`useOpenFeedPost`). There is no "get one post" read: the detail draws the
   * post from the lists, and from this copy once the post has left them while it is open (a save removed on a post
   * that only Kaydedilenler holds). Likes and saves are written into it like into every other copy.
   */
  opened: ['content', 'feed', 'opened'] as const,
};

export type FeedPages = InfiniteData<FeedPostPage, string | null>;

/**
 * A post from what is already in the cache — every loaded page of every tab, then the saved list, then the copy kept
 * when its detail was opened; null when none has it. The same object comes back until the post changes.
 */
export function findCachedFeedPost(client: QueryClient, postId: string): FeedPost | null {
  for (const [, pages] of client.getQueriesData<FeedPages>({ queryKey: feedKeys.posts })) {
    for (const page of pages?.pages ?? []) {
      const found = page.items.find((p) => p.id === postId);
      if (found) return found;
    }
  }
  const saved = client.getQueryData<FeedPost[]>(feedKeys.saved)?.find((p) => p.id === postId);
  if (saved) return saved;
  const opened = client.getQueryData<FeedPost | null>(feedKeys.opened);
  return opened && opened.id === postId ? opened : null;
}

/**
 * The post of the detail screen (`feed/[id]`), read live from the cache: a like, a save or a refetch anywhere redraws
 * it, and what is done on the detail shows on the cards. Null when the cache does not have the post (opened cold).
 */
export function useFeedPost(postId: string | null | undefined): FeedPost | null {
  const client = useQueryClient();
  const cache = client.getQueryCache();
  return useSyncExternalStore(
    (onChange) => cache.subscribe(onChange),
    () => (postId ? findCachedFeedPost(client, postId) : null),
  );
}

/** `GET v1/content/feed?occasion=&pageToken=` — editorial posts, newest first, 10 per page. */
export function useFeedPosts(tab: FeedTab) {
  return useInfiniteQuery({
    queryKey: feedKeys.postsOf(tab),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fromSource(
        'content',
        () => feedFixtures.page(tab, pageParam),
        async () =>
          toFeedPostPage(
            await apiRequest<FeedPostPageWire>(`v1/content/feed${queryString({ occasion: feedOccasionParam(tab), pageToken: pageParam })}`),
          ),
      ),
    getNextPageParam: (last) => last.nextPageToken,
  });
}

/** `GET v1/content/feed/story` — editor stories (the row after "Bugün"). */
export function useEditorStories() {
  return useQuery({
    queryKey: feedKeys.stories,
    queryFn: () =>
      fromSource<EditorStory[]>('content', () => feedFixtures.stories(), async () => (await apiRequest<FeedStoryWire[]>('v1/content/feed/story')).map(toEditorStory)),
  });
}

/** `GET v1/tenant/feed-post/saved` — feed posts this user saved (Profil › Kaydedilenler). */
export function useSavedFeedPosts(enabled = true) {
  return useQuery({
    queryKey: feedKeys.saved,
    enabled,
    queryFn: () =>
      fromSource<FeedPost[]>('content', () => feedFixtures.saved(), async () => (await apiRequest<FeedPostWire[]>('v1/tenant/feed-post/saved')).map(toFeedPost)),
  });
}

/** `GET v1/tenant/feed-post/{id}/similar` → ProductDto[] — catalogue products like the pieces of a member's look ("Benzerlerini gör"). */
export function useSimilarProducts(postId: string | null) {
  return useQuery({
    queryKey: feedKeys.similar(postId ?? 'none'),
    enabled: postId !== null,
    queryFn: () =>
      fromSource<ProductSummary[]>(
        'content',
        () => feedFixtures.similar(postId ?? ''),
        async () => (await apiRequest<ProductWire[]>(`v1/tenant/feed-post/${encodeURIComponent(postId ?? '')}/similar`)).map(toProductSummary),
      ),
  });
}
