import type { EditorStory, FeedPost, FeedPostPage, FeedProduct, FeedTab } from '@/api/contracts/feed';
import { FEED_PAGE_SIZE } from '@/api/contracts/feed';
import type { Occasion } from '@/api/contracts';
import { ApiError } from '@/api/errors';
import { FEED_INVITE_OCCASIONS, feedTabOccasions } from '@/api/wire/feed';

import { onFixtureSeed } from './db';
import { L } from './showcase';
import { productsFixture } from './store';

/**
 * Typed fixtures for Akış F1 (canvas 06″): editorial posts and stories. Author names are placeholders
 * ("Droblet Edit", "@ornek_stilist") — no real people. Photos are left out (`images: []` or unreachable
 * sample keys), so the look placeholder is drawn; real photos come from the admin panel through the API.
 * The module keeps a small in-memory state (likes, saves) reset with `resetFixtureDb`.
 */

const HOUR = 60 * 60_000;

function product(id: string, ownedSimilar = false): FeedProduct {
  const found = productsFixture.find((p) => p.id === id);
  if (!found) throw new Error(`fixture product ${id}`);
  return { ...found, name: L(found.name), ownedSimilar };
}

const EDIT = { kind: 'edit' as const, name: 'Droblet Edit', handle: null, imageUrl: null, verified: true };
const STYLIST = { kind: 'stylist' as const, name: '@ornek_stilist', handle: 'ornek_stilist', imageUrl: null, verified: false };

type Seed = {
  title: string;
  note: string | null;
  occasion: Occasion;
  edit: boolean;
  hoursAgo: number;
  imageCount: number;
  products: FeedProduct[];
  likeCount: number;
};

function seeds(): Seed[] {
  return [
    {
      title: L('Ofiste bordo & camel'),
      note: L('Camel kaban bordoyu yumuşatır; siyah pantolon ve loafer ofise taşır.'),
      occasion: 'office',
      edit: true,
      hoursAgo: 3,
      imageCount: 4,
      products: [product('prod_011', true), product('prod_022', true), product('prod_004'), product('prod_015')],
      likeCount: 1284,
    },
    {
      title: L('Hafta sonuna krem tonlar'),
      note: L('Pazar kahvaltısı için krem katmanlar.'),
      occasion: 'weekend',
      edit: false,
      hoursAgo: 5,
      imageCount: 1,
      products: [],
      likeCount: 846,
    },
    {
      title: L('Davette saten'),
      note: L('Bordo saten elbise, siyah clutch ve topuklu bot.'),
      occasion: FEED_INVITE_OCCASIONS[0]!,
      edit: true,
      hoursAgo: 9,
      imageCount: 2,
      products: [product('prod_008'), product('prod_034'), product('prod_031', true)],
      likeCount: 412,
    },
    {
      title: L('Gri flanel, beyaz gömlek'),
      note: null,
      occasion: 'office',
      edit: false,
      hoursAgo: 20,
      imageCount: 3,
      products: [product('prod_019'), product('prod_001', true)],
      likeCount: 233,
    },
    {
      title: L('Jean ve trençkot'),
      note: L('Bej trençkot her jean ile çalışır.'),
      occasion: 'weekend',
      edit: true,
      hoursAgo: 26,
      imageCount: 2,
      products: [product('prod_020'), product('prod_012', true), product('prod_024')],
      likeCount: 978,
    },
    ...Array.from({ length: 8 }, (_, i): Seed => ({
      title: L('Ofis için katmanlar') + ` ${i + 1}`,
      note: null,
      occasion: i % 2 === 0 ? 'office' : 'weekend',
      edit: i % 3 !== 0,
      hoursAgo: 30 + i * 6,
      imageCount: 1 + (i % 3),
      products: [product('prod_005'), product('prod_006', i % 2 === 0)],
      likeCount: 120 + i * 17,
    })),
  ];
}

function build(now: number): FeedPost[] {
  return seeds().map((s, index) => {
    const id = `post_${String(index + 1).padStart(3, '0')}`;
    return {
      id,
      author: s.edit ? EDIT : STYLIST,
      occasion: s.occasion,
      publishedAt: new Date(now - s.hoursAgo * HOUR).toISOString(),
      title: s.title,
      note: s.note,
      images: Array.from({ length: s.imageCount }, (_, i) => `fixture://feed/${id}/${i + 1}`),
      products: s.products,
      buyableCount: s.products.filter((p) => !p.ownedSimilar && p.available !== false).length,
      likeCount: s.likeCount,
      liked: false,
      saved: false,
    };
  });
}

function buildStories(now: number): EditorStory[] {
  const at = (h: number) => new Date(now - h * HOUR).toISOString();
  const story = (id: string, name: string, headline: string, productId: string | null, hoursAgo: number): EditorStory => ({
    id,
    author: { name, imageUrl: null },
    imageUrl: `fixture://feed/story/${id}`,
    headline,
    product: productId ? product(productId) : null,
    publishedAt: at(hoursAgo),
  });
  return [
    story('story_001', 'Droblet Edit', L('Ofiste bordo & camel'), 'prod_004', 2),
    story('story_002', '@ornek_stilist', L('Hafta sonuna krem tonlar'), 'prod_020', 6),
    story('story_003', L('Kış edit\'i'), L('Kaşmir ve yün'), 'prod_030', 12),
  ];
}

const state: { posts: FeedPost[]; stories: EditorStory[]; savedOrder: string[]; failNext: boolean } = {
  posts: [],
  stories: [],
  savedOrder: [],
  failNext: false,
};

export function resetFeedFixtures(options: { empty?: boolean } = {}): void {
  const now = Date.now();
  state.posts = options.empty ? [] : build(now);
  state.stories = options.empty ? [] : buildStories(now);
  state.savedOrder = [];
  state.failNext = false;
}

onFixtureSeed((_db, { empty }) => resetFeedFixtures({ empty }));

/** Test switches. */
export const feedFixtureOptions = {
  /** The next feed read fails with a final answer (no retry), so the error state shows at once. */
  failNextRead() {
    state.failNext = true;
  },
  setPosts(posts: FeedPost[]) {
    state.posts = posts;
  },
};

function find(id: string): FeedPost {
  const post = state.posts.find((p) => p.id === id);
  if (!post) throw new ApiError('http', 404, { code: 'not_found', status: 404 });
  return post;
}

export const feedFixtures = {
  page: (tab: FeedTab, pageToken: string | null): FeedPostPage => {
    if (state.failNext) {
      state.failNext = false;
      throw new ApiError('http', 400, { code: 'bad_request', status: 400 });
    }
    const occasions: readonly string[] | null = feedTabOccasions(tab);
    const all = occasions ? state.posts.filter((p) => p.occasion !== null && occasions.includes(p.occasion)) : state.posts;
    const start = pageToken ? Number(pageToken) : 0;
    const items = all.slice(start, start + FEED_PAGE_SIZE).map((p) => ({ ...p }));
    const next = start + FEED_PAGE_SIZE;
    return { items, nextPageToken: next < all.length ? String(next) : null };
  },
  stories: (): EditorStory[] => state.stories.map((s) => ({ ...s })),
  like: (id: string, liked: boolean): { liked: boolean; likeCount: number } => {
    const post = find(id);
    if (post.liked !== liked) post.likeCount = Math.max(0, post.likeCount + (liked ? 1 : -1));
    post.liked = liked;
    return { liked, likeCount: post.likeCount };
  },
  save: (id: string, saved: boolean): void => {
    const post = find(id);
    post.saved = saved;
    state.savedOrder = state.savedOrder.filter((s) => s !== id);
    if (saved) state.savedOrder.unshift(id);
  },
  saved: (): FeedPost[] =>
    state.savedOrder.map((id) => state.posts.find((p) => p.id === id)).filter((p): p is FeedPost => Boolean(p)).map((p) => ({ ...p })),
};
