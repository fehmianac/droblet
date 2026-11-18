import { EMPTY_PRODUCT_QUERY } from '@/features/store/queries';

import type { ProductWire } from './catalog';
import {
  fromBuilderLook,
  fromCartLine,
  fromProductSort,
  splitProductQuery,
  toCart,
  toCheckout,
  toCompleteSuggestions,
  toCreatorCard,
  toProductMatch,
  toProductPage,
  toProductSummary,
  toSeriesOutfit,
  toWatchlistEntry,
  toWeeklyEditSummary,
} from './store';

/** `ProductDto` as documented in docs/api/store-social-settings.md §1. */
const shirt: ProductWire = {
  id: 'hs-white-shirt',
  brandId: 'gap',
  brandName: 'Gap',
  name: 'Beyaz Poplin Gömlek',
  description: 'Pamuk poplin.',
  category: 'shirt',
  slot: 'top',
  colors: ['white'],
  sizes: ['XS', 'S', 'M', 'L'],
  priceMinor: 100000,
  currency: 'TRY',
  previousPriceMinor: 120000,
  priceBand: 'highStreet',
  images: ['https://cdn.example/shirt.jpg'],
  available: true,
  createdAt: '2026-11-18T09:00:00Z',
};
const bag: ProductWire = {
  ...shirt,
  id: 'lx-bag',
  brandId: 'vakko',
  brandName: 'Vakko',
  name: 'Deri El Çantası',
  category: 'bag',
  slot: 'bag',
  colors: ['black'],
  sizes: [],
  priceMinor: 900000,
  previousPriceMinor: null,
  priceBand: 'luxuryTouch',
  images: [],
};
const knit: ProductWire = { ...shirt, id: 'knit-1', category: 'knitwear', colors: ['cream', 'beige'] };

describe('store wire mappers', () => {
  it('maps a product: Money, first image, enum spelling', () => {
    expect(toProductSummary(shirt)).toMatchObject({
      id: 'hs-white-shirt',
      brandId: 'gap',
      price: { amountMinor: 100000, currency: 'TRY' },
      previousPrice: { amountMinor: 120000, currency: 'TRY' },
      imageUrl: 'https://cdn.example/shirt.jpg',
      category: 'shirt',
      sizes: ['XS', 'S', 'M', 'L'],
      available: true,
      priceBand: 'high_street',
    });
  });

  it('a product without sizes is one-size and has no previous price or image', () => {
    const p = toProductSummary(bag);
    expect(p.sizes).toEqual(['ONE']);
    expect(p.previousPrice).toBeNull();
    expect(p.imageUrl).toBeNull();
    expect(p.priceBand).toBe('luxury_touch');
  });

  it('knitwear is the app category "knit"', () => {
    expect(toProductSummary(knit).category).toBe('knit');
  });

  it('sends single-valued filters to the server and applies multi-valued ones on the device', () => {
    const single = splitProductQuery({ ...EMPTY_PRODUCT_QUERY, categories: ['knit'], brandIds: ['gap'], sizes: ['ONE'] });
    expect(single.server).toEqual({ category: 'knitwear', brand: 'gap', size: undefined });

    const multi = splitProductQuery({ ...EMPTY_PRODUCT_QUERY, categories: ['shirt', 'knit'], colors: ['cream', 'black'] });
    expect(multi.server).toEqual({});
    const page = toProductPage({ items: [shirt, bag, knit], pageToken: 'next', count: 3 }, multi.local);
    expect(page.items.map((p) => p.id)).toEqual(['knit-1']);
    expect(page.nextPageToken).toBe('next');
    expect(page.count).toBe(3);
  });

  it('maps the sort keys', () => {
    expect(fromProductSort('newest')).toBe('newest');
    expect(fromProductSort('price_asc')).toBe('priceAsc');
    expect(fromProductSort('price_desc')).toBe('priceDesc');
  });

  it('maps the weekly edit cover and content collections', () => {
    expect(
      toWeeklyEditSummary({
        id: 'edit-sample-2026-w47',
        title: 'Sonbahar katmanları',
        subtitle: 'Yedi gün, yedi look.',
        coverImageUrl: 'https://cdn.example/cover.jpg',
        weekStart: '2026-11-16',
        weekEnd: '2026-11-22',
        segment: 'women',
        sponsored: false,
        sponsorName: null,
        looks: [1, 2, 3, 4, 5, 6, 7].map((day) => ({ id: `d${day}`, day, imageUrl: null })),
      }),
    ).toEqual({
      id: 'edit-sample-2026-w47',
      title: 'Sonbahar katmanları',
      startDate: '2026-11-16',
      endDate: '2026-11-22',
      lookCount: 7,
      imageUrl: 'https://cdn.example/cover.jpg',
    });

    const collection = { id: 'creator-1', kind: 'creator' as const, title: 'Editör 1', subtitle: null, imageUrl: null, sponsored: true, sponsorName: 'Gap' };
    expect(toCreatorCard(collection)).toEqual({
      id: 'creator-1',
      handle: null,
      displayName: 'Editör 1',
      role: null,
      lookTitle: '',
      imageUrl: null,
      sponsored: true,
    });
    // A creator with a Droblet account carries its @handle (find-friends creator row).
    expect(toCreatorCard({ ...collection, handle: '@ornek_stilist' }).handle).toBe('ornek_stilist');
    expect(toSeriesOutfit({ ...collection, kind: 'series', subtitle: 'Dizi' })).toEqual({
      id: 'creator-1',
      title: 'Editör 1',
      seriesName: 'Dizi',
      imageUrl: null,
    });
  });

  it('maps match and complete', () => {
    expect(
      toProductMatch({
        productId: 'hs-white-shirt',
        compatibleCount: 3,
        items: [{ id: 'i1', name: 'Lacivert blazer', category: 'outerwear', colors: ['navy'], imageUrl: null }],
      }),
    ).toEqual({ count: 3, items: [{ id: 'i1', name: 'Lacivert blazer', imageUrl: null }] });

    const complete = toCompleteSuggestions({
      slots: [
        { slot: 'top', products: [shirt, knit] },
        { slot: 'bag', products: [bag, shirt] },
      ],
    });
    expect(complete.products.map((p) => p.id)).toEqual(['hs-white-shirt', 'knit-1', 'lx-bag']);
  });

  it('maps the cart: Money totals, retired products carry no price', () => {
    const cart = toCart({
      groups: [
        {
          brandId: 'gap',
          brandName: 'Gap',
          subtotalMinor: 100000,
          lines: [
            { lineId: 'l1', product: shirt, size: 'M', look: null, addedAt: '2026-11-18T09:00:00Z' },
            { lineId: 'l2', product: { ...knit, available: false }, size: 'S', look: { kind: 'edit', id: 'e1' }, addedAt: '2026-11-18T09:00:00Z' },
          ],
        },
      ],
      lineCount: 2,
      totalMinor: 100000,
      currency: 'TRY',
    });
    expect(cart.lineCount).toBe(2);
    expect(cart.total).toEqual({ amountMinor: 100000, currency: 'TRY' });
    expect(cart.groups[0]?.subtotal).toEqual({ amountMinor: 100000, currency: 'TRY' });
    expect(cart.groups[0]?.lines[0]).toMatchObject({ lineId: 'l1', productId: 'hs-white-shirt', size: 'M', available: true });
    expect(cart.groups[0]?.lines[1]).toMatchObject({ price: null, available: false });
    expect(toCart({ groups: [], lineCount: 0, totalMinor: 0, currency: 'TRY' }).total).toBeNull();
  });

  it('builds cart lines: no size for a one-size product, look ref passed through', () => {
    expect(fromCartLine({ clientMutationId: 'c1', productId: 'lx-bag', size: 'ONE' })).toEqual({ clientMutationId: 'c1', productId: 'lx-bag' });
    expect(fromCartLine({ clientMutationId: 'c2', productId: 'hs-white-shirt', size: 'M', look: { kind: 'edit', id: 'e1' } })).toEqual({
      clientMutationId: 'c2',
      productId: 'hs-white-shirt',
      size: 'M',
      look: { kind: 'edit', id: 'e1' },
    });
  });

  it('maps checkout and watch-list entries', () => {
    expect(
      toCheckout({ clickId: '01J', url: 'https://shop.example/p?click_id=01J', source: 'network', brandId: 'gap', brandName: 'Gap', products: [] }),
    ).toEqual({ checkoutUrl: 'https://shop.example/p?click_id=01J', clickId: '01J' });

    const watch = {
      product: shirt,
      size: 'M',
      look: null,
      priceAtAddMinor: 120000,
      currentPriceMinor: 100000,
      priceDropped: true,
      dropMinor: 20000,
      addedAt: '2026-11-18T09:00:00Z',
    };
    expect(toWatchlistEntry(watch)).toMatchObject({
      productId: 'hs-white-shirt',
      price: { amountMinor: 100000, currency: 'TRY' },
      previousPrice: { amountMinor: 120000, currency: 'TRY' },
      alertEnabled: true,
      source: { kind: 'manual' },
    });
    const fromEdit = toWatchlistEntry({ ...watch, priceDropped: false, look: { kind: 'edit', id: 'e1' } }, new Set(['hs-white-shirt']));
    expect(fromEdit.previousPrice).toBeNull();
    expect(fromEdit.alertEnabled).toBe(false);
    expect(fromEdit.source).toEqual({ kind: 'edit' });
  });

  it('writes a builder look with wire slots and source', () => {
    expect(
      fromBuilderLook({
        id: '01JLOOK',
        clientMutationId: '01JMUT',
        name: 'Kombinim',
        occasion: null,
        slots: [
          { slot: 'top', source: 'wardrobe', itemId: 'i1' },
          { slot: 'bag', source: 'store', productId: 'lx-bag' },
        ],
      }),
    ).toEqual({
      id: '01JLOOK',
      name: 'Kombinim',
      occasion: null,
      slots: [
        { slot: 'top', itemId: 'i1' },
        { slot: 'bagAccessory', productId: 'lx-bag' },
      ],
      favorite: false,
      source: 'builder',
    });
  });
});
