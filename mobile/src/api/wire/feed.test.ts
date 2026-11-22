import type { ProductWire } from './catalog';
import { feedOccasionParam, feedTabOfOccasion, toEditorStory, toFeedPost, toFeedPostPage, type FeedPostWire } from './feed';

const product = (over: Partial<ProductWire> = {}): ProductWire => ({
  id: 'p1',
  brandId: 'b1',
  brandName: 'Marka D',
  name: 'Bordo deri çanta',
  description: null,
  category: 'bag',
  slot: 'bag',
  colors: ['burgundy'],
  sizes: [],
  priceMinor: 129500,
  currency: 'TRY',
  previousPriceMinor: null,
  priceBand: 'highStreet',
  images: ['https://cdn.test/p1.jpg'],
  available: true,
  createdAt: '2026-11-01T00:00:00Z',
  ...over,
});

const post = (over: Partial<FeedPostWire> = {}): FeedPostWire => ({
  id: 'post_1',
  author: { kind: 'edit', name: 'Droblet Edit', handle: null, imageUrl: null, verified: true },
  occasion: 'office',
  publishedAt: '2026-11-18T09:00:00Z',
  title: 'Ofiste bordo & camel',
  note: null,
  images: ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg'],
  products: [{ ...product(), ownedSimilar: false }, { ...product({ id: 'p2', category: 'knitwear', slot: 'top' }), ownedSimilar: true }],
  buyableCount: 1,
  likeCount: 1284,
  liked: false,
  saved: true,
  ...over,
});

describe('feed wire mappers', () => {
  it('maps a FeedPostDto: author, occasion, images, products (+ ownedSimilar), counters', () => {
    const mapped = toFeedPost(post());
    expect(mapped).toMatchObject({
      id: 'post_1',
      author: { kind: 'edit', name: 'Droblet Edit', handle: null, verified: true },
      occasion: 'office',
      title: 'Ofiste bordo & camel',
      images: ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg'],
      buyableCount: 1,
      likeCount: 1284,
      liked: false,
      saved: true,
    });
    expect(mapped.products[0]).toMatchObject({ id: 'p1', brandName: 'Marka D', price: { amountMinor: 129500, currency: 'TRY' }, ownedSimilar: false, sizes: ['ONE'] });
    // The catalogue's `knitwear` is the app's `knit`.
    expect(mapped.products[1]).toMatchObject({ id: 'p2', category: 'knit', ownedSimilar: true });
  });

  it('tolerates missing optional fields and strips the @ of a stylist handle', () => {
    const mapped = toFeedPost(
      post({
        author: { kind: 'stylist', name: '@ornek_stilist', handle: '@ornek_stilist', imageUrl: null, verified: false },
        occasion: null,
        images: null,
        products: null,
        buyableCount: null,
        likeCount: null,
        liked: null,
        saved: null,
      }),
    );
    expect(mapped).toMatchObject({ author: { kind: 'stylist', handle: 'ornek_stilist' }, occasion: null, images: [], products: [], buyableCount: 0, likeCount: 0, liked: false, saved: false });
  });

  it('maps a page and its cursor', () => {
    expect(toFeedPostPage({ items: [post()], pageToken: 'abc' })).toMatchObject({ items: [{ id: 'post_1' }], nextPageToken: 'abc' });
    expect(toFeedPostPage({ items: [], pageToken: null }).nextPageToken).toBeNull();
  });

  it('maps a FeedStoryDto with and without a product', () => {
    const story = toEditorStory({
      id: 's1',
      author: { name: 'Droblet Edit', imageUrl: null },
      imageUrl: 'https://cdn.test/s1.jpg',
      headline: 'Kaşmir ve yün',
      product: product(),
      publishedAt: '2026-11-18T09:00:00Z',
    });
    expect(story).toMatchObject({ id: 's1', headline: 'Kaşmir ve yün', imageUrl: 'https://cdn.test/s1.jpg', product: { id: 'p1', imageUrl: 'https://cdn.test/p1.jpg' } });
    expect(toEditorStory({ id: 's2', author: { name: 'X', imageUrl: null }, imageUrl: null, headline: 'h', product: null, publishedAt: '' }).product).toBeNull();
  });

  it('sends the occasion filter of a tab; "Davet" = dinner + wedding', () => {
    expect(feedOccasionParam('all')).toBeNull();
    expect(feedOccasionParam('office')).toBe('office');
    expect(feedOccasionParam('weekend')).toBe('weekend');
    expect(feedOccasionParam('invite')).toBe('dinner,wedding');
    expect(feedTabOfOccasion('dinner')).toBe('invite');
    expect(feedTabOfOccasion('wedding')).toBe('invite');
    expect(feedTabOfOccasion('office')).toBe('office');
    expect(feedTabOfOccasion('sport')).toBeNull();
    expect(feedTabOfOccasion(null)).toBeNull();
  });
});
