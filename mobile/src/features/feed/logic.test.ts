import type { InfiniteData } from '@tanstack/react-query';

import type { FeedPost, FeedPostPage } from '@/api/contracts/feed';
import i18n from '@/i18n';

import {
  applyLike,
  buyableProducts,
  firstViewThisSession,
  hidePostThisSession,
  isHiddenThisSession,
  ownedItemIds,
  ownedProducts,
  postMeta,
  removeFeedPost,
  resetFeedSession,
  shortAge,
  updateFeedPosts,
} from './logic';

const base: FeedPost = {
  id: 'p1',
  kind: 'editor',
  pieces: [],
  hasSimilar: false,
  canTryOn: true,
  author: { kind: 'edit', name: 'Droblet Edit', handle: null, imageUrl: null, verified: true },
  occasion: 'office',
  publishedAt: '2026-11-18T09:00:00Z',
  title: 'T',
  note: null,
  images: [],
  products: [],
  buyableCount: 0,
  likeCount: 10,
  liked: false,
  saved: false,
};

const product = (id: string, ownedSimilar: boolean, available = true) =>
  ({ id, brandId: 'b', brandName: 'B', name: id, price: null, imageUrl: null, category: 'bag', colors: [], sizes: ['ONE'], available, ownedSimilar, ownedItemId: null }) as FeedPost['products'][number];

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});

describe('feed logic', () => {
  it('applies a like / unlike once', () => {
    expect(applyLike(base, true)).toMatchObject({ liked: true, likeCount: 11 });
    expect(applyLike({ ...base, liked: true, likeCount: 11 }, false)).toMatchObject({ liked: false, likeCount: 10 });
    expect(applyLike(base, false)).toBe(base);
    expect(applyLike({ ...base, likeCount: 0, liked: true }, false).likeCount).toBe(0);
  });

  it('updates a post across all loaded pages', () => {
    const data: InfiniteData<FeedPostPage, string | null> = {
      pages: [{ items: [base, { ...base, id: 'p2' }], nextPageToken: 'x' }, { items: [{ ...base, id: 'p3' }], nextPageToken: null }],
      pageParams: [null, 'x'],
    };
    const next = updateFeedPosts(data, (p) => p.id === 'p3', (p) => ({ ...p, saved: true }));
    expect(next?.pages[1]?.items[0]?.saved).toBe(true);
    expect(next?.pages[0]?.items[0]).toBe(base);
    expect(updateFeedPosts(undefined, () => true, (p) => p)).toBeUndefined();
  });

  it('splits buyable and owned products', () => {
    const post = { products: [product('a', false), product('b', true), product('c', false, false)] };
    expect(buyableProducts(post).map((p) => p.id)).toEqual(['a']);
    expect(ownedProducts(post).map((p) => p.id)).toEqual(['b']);
  });

  it('writes the meta line as on the board', () => {
    const now = new Date('2026-11-18T12:00:00Z');
    expect(postMeta(i18n.t, base, now)).toBe('Ofis · Sonbahar · 3 sa');
    expect(postMeta(i18n.t, { ...base, author: { ...base.author, kind: 'stylist' }, occasion: 'weekend', publishedAt: '2026-11-18T07:00:00Z' }, now)).toBe(
      'Seçili stilist · Hafta sonu · 5 sa',
    );
    expect(postMeta(i18n.t, { ...base, occasion: 'dinner' }, now)).toBe('Davet · Sonbahar · 3 sa');
    expect(shortAge(i18n.t, '2026-11-15T12:00:00Z', now)).toBe('3 g');
  });

  it("writes a member's meta line: Topluluk · ortam · zaman (no season)", () => {
    const now = new Date('2026-11-18T12:00:00Z');
    const user = { ...base, kind: 'user' as const, author: { ...base.author, kind: 'user' as const, name: '@ornek_kullanici' }, occasion: 'weekend' as const, publishedAt: '2026-11-18T11:00:00Z' };
    expect(postMeta(i18n.t, user, now)).toBe('Topluluk · Hafta sonu · 1 sa');
  });

  it('removes a hidden post from every loaded page and keeps it out for the session', () => {
    const data: InfiniteData<FeedPostPage, string | null> = {
      pages: [{ items: [base, { ...base, id: 'p2' }], nextPageToken: 'x' }, { items: [{ ...base, id: 'p3' }], nextPageToken: null }],
      pageParams: [null, 'x'],
    };
    expect(removeFeedPost(data, 'p2')?.pages.map((p) => p.items.map((i) => i.id))).toEqual([['p1'], ['p3']]);
    expect(removeFeedPost(undefined, 'p2')).toBeUndefined();
    resetFeedSession();
    expect(isHiddenThisSession('p2')).toBe(false);
    hidePostThisSession('p2');
    expect(isHiddenThisSession('p2')).toBe(true);
    resetFeedSession();
    expect(isHiddenThisSession('p2')).toBe(false);
  });

  it('"Kendi parçalarımla kur": the distinct wardrobe items behind the owned pieces', () => {
    const owned = (id: string, itemId: string | null) => ({ ...product(id, true), ownedItemId: itemId });
    expect(ownedItemIds({ products: [owned('a', 'i1'), owned('b', 'i2'), owned('c', 'i1'), owned('d', null), { ...product('e', false), ownedItemId: 'i9' }] })).toEqual(['i1', 'i2']);
  });

  it('reports a post view once per session', () => {
    resetFeedSession();
    expect(firstViewThisSession('p1')).toBe(true);
    expect(firstViewThisSession('p1')).toBe(false);
    resetFeedSession();
    expect(firstViewThisSession('p1')).toBe(true);
  });
});
