import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type { EditorStory, FeedPost, FeedPostPage, FeedTab } from '@/api/contracts/feed';
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
};

export type FeedPages = InfiniteData<FeedPostPage, string | null>;

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
