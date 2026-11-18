import { fixtureDb } from '@/fixtures/db';
import { slotOfItemCategory } from '@/features/store/slots';
import type { Cart, ProductSummary } from '@/api/contracts/store';
import { brandsFixture, buildCart, creatorsFixture, filterProducts, localizedCatalogue, paginate, productsFixture } from '@/fixtures/store';

import { EMPTY_SLOTS, filledCount, firstEmptySlot, storeItems, storeTotal, toLookSlots, withProduct } from './builder';
import { addLinesToCart, preferredSize, priceDropPercent, removeLineFromCart } from './cartMath';
import { clearSheetFilters, filterCount, toggleValue } from './filters';
import { EMPTY_PRODUCT_QUERY } from './queries';

const lira = (amount: number) => ({ amountMinor: amount * 100, currency: 'TRY' });
const byId = (id: string): ProductSummary => {
  const p = productsFixture.find((x) => x.id === id);
  if (!p) throw new Error(id);
  return p;
};

describe('catalogue filtering and paging', () => {
  it('filters by category, brand, colour, size and search text (Turkish-insensitive)', () => {
    expect(filterProducts(productsFixture, { ...EMPTY_PRODUCT_QUERY, categories: ['shoes'] }).every((p) => p.category === 'shoes')).toBe(true);
    expect(filterProducts(productsFixture, { ...EMPTY_PRODUCT_QUERY, colors: ['olive'] }).length).toBeGreaterThan(0);
    expect(filterProducts(productsFixture, { ...EMPTY_PRODUCT_QUERY, sizes: ['38'] }).every((p) => p.category === 'shoes')).toBe(true);
    expect(filterProducts(productsFixture, { ...EMPTY_PRODUCT_QUERY, q: 'İPEK' }).map((p) => p.name)).toEqual(['İpek Fular']);
    expect(filterProducts(productsFixture, { ...EMPTY_PRODUCT_QUERY, q: 'bordo' }).length).toBeGreaterThan(1);
    const brand = filterProducts(productsFixture, { ...EMPTY_PRODUCT_QUERY, brandIds: ['brand_vakko'] });
    expect(brand.length).toBeGreaterThan(0);
    expect(brand.every((p) => p.brandId === 'brand_vakko')).toBe(true);
  });

  it('sorts by price with unpriced products last', () => {
    const asc = filterProducts(productsFixture, { ...EMPTY_PRODUCT_QUERY, sort: 'price_asc' });
    const prices = asc.map((p) => p.price?.amountMinor ?? null);
    const priced = prices.filter((p): p is number => p !== null);
    expect(priced).toEqual([...priced].sort((a, b) => a - b));
    expect(prices.slice(priced.length).every((p) => p === null)).toBe(true);
  });

  it('pages with an opaque token until the list ends', () => {
    const first = paginate(productsFixture, null, 12);
    expect(first.items).toHaveLength(12);
    const second = paginate(productsFixture, first.nextPageToken, 12);
    const third = paginate(productsFixture, second.nextPageToken, 12);
    expect(third.nextPageToken).toBeNull();
    expect([...first.items, ...second.items, ...third.items]).toHaveLength(productsFixture.length);
  });
});

describe('fixture catalogue', () => {
  it('uses the brands and example prices of the design canvas, without bundled logos', () => {
    expect(brandsFixture.map((b) => b.name)).toEqual(['Marks & Spencer', 'Vakko', 'Beymen Club', 'Communité', 'Gap', 'Lululemon']);
    expect(brandsFixture.every((b) => !b.logoUrl)).toBe(true);
    const price = (name: string) => productsFixture.find((p) => p.name === name);
    expect(price('Beyaz Poplin Gömlek')).toMatchObject({ brandName: 'Marks & Spencer', price: lira(3000) });
    expect(price('Yün Karışımlı Balloon Paça Pantolon')).toMatchObject({ brandName: 'Marks & Spencer', price: lira(7300) });
    expect(price('Deri Kroko Babet')).toMatchObject({ brandName: 'Marks & Spencer', price: lira(3300) });
    expect(price('City Medium Siyah Çanta')).toMatchObject({ brandName: 'Beymen Club', price: lira(12950) });
    expect(price('Yün Karışımlı Blazer')).toMatchObject({ brandName: 'Vakko', price: null });
    expect(price('Triko Kazak')?.brandName).toBe('Communité');
  });

  it('localizes product names like the server would, keeping brand names as they are', () => {
    expect(localizedCatalogue('tr')[0]?.name).toBe('Beyaz Poplin Gömlek');
    expect(localizedCatalogue('en')[0]).toMatchObject({ name: 'White Poplin Shirt', brandName: 'Marks & Spencer' });
  });
});

describe('cart', () => {
  const rows = [
    { lineId: 'a', productId: 'prod_001', size: 'S' },
    { lineId: 'b', productId: 'prod_003', size: '38' },
    { lineId: 'c', productId: 'prod_004', size: 'ONE' },
  ];

  it('groups lines by brand with subtotals and a total', () => {
    const cart = buildCart(rows, productsFixture);
    // The canvas cart: two Marks & Spencer lines (₺6.300) and one Beymen Club line (₺12.950).
    expect(cart.groups.map((g) => [g.brandName, g.lines.length])).toEqual([
      ['Marks & Spencer', 2],
      ['Beymen Club', 1],
    ]);
    expect(cart.groups[0]?.subtotal).toEqual(lira(6300));
    expect(cart.total).toEqual(lira(19250));
    expect(cart.lineCount).toBe(3);
  });

  it('adds optimistically, idempotent on clientMutationId, and removes with empty groups dropped', () => {
    const start: Cart = buildCart(rows.slice(0, 1), productsFixture);
    const line = { clientMutationId: 'm1', product: byId('prod_004'), size: 'ONE' };
    const added = addLinesToCart(start, [line]);
    expect(added.groups).toHaveLength(2);
    expect(added.total).toEqual(lira(15950));
    // A second product of a brand already in the cart joins that brand's group.
    expect(addLinesToCart(added, [{ clientMutationId: 'm2', product: byId('prod_006'), size: 'S' }]).groups.map((g) => g.lines.length)).toEqual([2, 1]);
    expect(addLinesToCart(added, [line])).toEqual(added);
    const removed = removeLineFromCart(added, 'm1');
    expect(removed.groups).toHaveLength(1);
    expect(removed.lineCount).toBe(1);
    expect(addLinesToCart(undefined, [line]).lineCount).toBe(1);
  });

  it('computes the price drop and the preselected size', () => {
    expect(priceDropPercent(lira(3300), lira(4125))).toBe(20);
    expect(priceDropPercent(lira(3300), lira(3300))).toBeNull();
    expect(priceDropPercent(lira(3300), null)).toBeNull();
    expect(priceDropPercent(lira(1), { amountMinor: 500, currency: 'EUR' })).toBeNull();
    expect(preferredSize(['XS', 'S', 'M'], 'S')).toBe('S');
    expect(preferredSize(['36', '37'], 'S')).toBeNull();
    expect(preferredSize(['ONE'], 'S')).toBe('ONE');
  });
});

describe('outfit builder', () => {
  it('places products in their slot, counts store pieces and builds the look', () => {
    let slots = withProduct(EMPTY_SLOTS, byId('prod_001'), 'S'); // shirt → top
    slots = withProduct(slots, byId('prod_003'), 'S'); // shoes
    const blazer = fixtureDb.items.find((w) => slotOfItemCategory(w.category) === 'outerwear');
    if (!blazer) throw new Error('fixture');
    slots = { ...slots, outerwear: { source: 'wardrobe', piece: blazer } };

    expect(filledCount(slots)).toBe(3);
    expect(firstEmptySlot(slots)).toBe('bottom');
    expect(storeItems(slots).map((i) => [i.product.id, i.size])).toEqual([
      ['prod_001', 'S'],
      ['prod_003', '36'],
    ]);
    expect(storeTotal(slots)).toEqual(lira(6300));
    expect(toLookSlots(slots)).toEqual([
      { slot: 'top', source: 'store', productId: 'prod_001' },
      { slot: 'outerwear', source: 'wardrobe', itemId: blazer.id },
      { slot: 'shoes', source: 'store', productId: 'prod_003' },
    ]);
  });

  it('ignores products that fit no slot', () => {
    expect(withProduct(EMPTY_SLOTS, byId('prod_008'), null)).toEqual(EMPTY_SLOTS); // dress
  });
});

describe('the one "Filtrele" sheet (21)', () => {
  const query = { ...EMPTY_PRODUCT_QUERY, categories: ['shirt' as const], brandIds: ['brand_ms', 'brand_vakko'], colors: ['white' as const], sizes: ['S'], q: 'poplin', sort: 'price_asc' as const };

  it('counts the active values of each chip', () => {
    expect(filterCount(query, 'brand')).toBe(2);
    expect(filterCount(query, 'color')).toBe(1);
    expect(filterCount(query, 'size')).toBe(1);
    expect(filterCount(EMPTY_PRODUCT_QUERY, 'brand')).toBe(0);
  });

  it('"Temizle" resets brand, colour, size and sort, and keeps the search text and the category chip', () => {
    expect(clearSheetFilters(query)).toEqual({ ...EMPTY_PRODUCT_QUERY, categories: ['shirt'], q: 'poplin' });
  });

  it('toggles a chip value on and off', () => {
    expect(toggleValue(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleValue(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('creators (20)', () => {
  it('keeps people as neutral placeholders and carries the sponsored flag as data', () => {
    expect(creatorsFixture.map((c) => c.displayName)).toEqual(['@ornek_stilist', '@ornek_editor', 'Marka vitrini']);
    expect(creatorsFixture.filter((c) => c.sponsored).map((c) => c.id)).toEqual(['creator_3']);
    // A sponsored showcase is a brand placement, not a person: it has no profile to open.
    expect(creatorsFixture.find((c) => c.sponsored)?.handle).toBeNull();
  });
});
