import { fixtureDb } from '@/fixtures/db';
import {
  ONE_SIZE,
  type AddCartLinesRequest,
  type Brand,
  type Cart,
  type CartGroup,
  type CatalogColor,
  type CheckoutResponse,
  type CompleteSuggestions,
  type CreatorCard,
  type FavoriteProducts,
  type ProductCategory,
  type ProductDetail,
  type ProductMatch,
  type ProductPage,
  type ProductQuery,
  type ProductSummary,
  type SeriesOutfit,
  type SetWatchRequest,
  type Watchlist,
  type WatchlistEntry,
  type WeeklyEditSummary,
} from '@/api/contracts/store';
import { ApiError } from '@/api/errors';
import { slotOfCategory, slotOfItemCategory } from '@/features/store/slots';
import { currentLanguage } from '@/i18n';
import { moneyFromMajor, sumMoney, toIsoDate, type Money } from '@/lib/format';

/**
 * Typed fixtures for E8 (Keşfet, mağaza, sepet, izleme listesi), used while `DATA_SOURCE` points the
 * feature at 'fixture'. Brands and product names follow the design canvas / brief; prices are the
 * canvas examples where it shows one and plain sample values elsewhere — FIXTURES ONLY, real names,
 * prices and brand logos come from the catalogue API. `logoUrl` is deliberately empty: official
 * logo files are supplied by the owner / brands through the catalogue, never drawn or bundled here.
 * The module keeps a small in-memory state so writes (cart, watchlist, favourites) behave like a
 * server within one app session.
 */

const BRANDS = {
  ms: { id: 'brand_ms', name: 'Marks & Spencer', logoUrl: null },
  vakko: { id: 'brand_vakko', name: 'Vakko', logoUrl: null },
  beymen: { id: 'brand_beymen_club', name: 'Beymen Club', logoUrl: null },
  communite: { id: 'brand_communite', name: 'Communité', logoUrl: null },
  gap: { id: 'brand_gap', name: 'Gap', logoUrl: null },
  lululemon: { id: 'brand_lululemon', name: 'Lululemon', logoUrl: null },
} satisfies Record<string, Brand>;
type BrandKey = keyof typeof BRANDS;

export const brandsFixture: Brand[] = Object.values(BRANDS);

/** Fixture prices are whole lira amounts; the wire format is minor units + ISO code. */
const lira = (amount: number): Money => moneyFromMajor(amount, 'TRY');

const APPAREL = ['XS', 'S', 'M', 'L', 'XL'];
const SHOES = ['36', '37', '38', '39', '40'];
const SINGLE = [ONE_SIZE];

type Seed = [tr: string, en: string, brand: BrandKey, category: ProductCategory, colors: CatalogColor[], price: number | null];

/** The first rows are the canvas examples (with the canvas prices); the rest are sample values. */
const SEEDS: Seed[] = [
  ['Beyaz Poplin Gömlek', 'White Poplin Shirt', 'ms', 'shirt', ['white'], 3000],
  ['Yün Karışımlı Blazer', 'Wool-Blend Blazer', 'vakko', 'jacket', ['navy'], null],
  ['Deri Kroko Babet', 'Leather Croc Ballet Flats', 'ms', 'shoes', ['black'], 3300],
  ['City Medium Siyah Çanta', 'City Medium Black Bag', 'beymen', 'bag', ['black'], 12950],
  ['Triko Kazak', 'Knit Jumper', 'communite', 'knit', ['cream'], 4200],
  ['Yün Karışımlı Balloon Paça Pantolon', 'Wool-Blend Balloon-Leg Trousers', 'ms', 'trousers', ['black'], 7300],
  ['Pamuklu Basic Tişört', 'Cotton Basic T-Shirt', 'gap', 'tshirt', ['white'], 900],
  ['Saten Midi Elbise', 'Satin Midi Dress', 'vakko', 'dress', ['burgundy'], 5400],
  ['Küçük Taşlı Küpe', 'Small Stone Earrings', 'beymen', 'accessory', ['cream'], null],
  ['Keten Oversize Gömlek', 'Oversized Linen Shirt', 'communite', 'shirt', ['beige'], 2800],
  ['Karamel Yün Kaban', 'Camel Wool Coat', 'vakko', 'jacket', ['camel'], 9800],
  ['Düz Paça Jean', 'Straight-Leg Jeans', 'gap', 'trousers', ['navy'], 2400],
  ['Zeytin Rengi Triko Yelek', 'Olive Knit Vest', 'communite', 'knit', ['olive'], 2100],
  ['Çizgili Uzun Kollu Tişört', 'Striped Long-Sleeve T-Shirt', 'gap', 'tshirt', ['navy', 'white'], 1100],
  ['Süet Loafer', 'Suede Loafers', 'beymen', 'shoes', ['brown'], 4700],
  ['İpek Fular', 'Silk Scarf', 'vakko', 'accessory', ['burgundy', 'cream'], 1600],
  ['Mini Omuz Çantası', 'Mini Shoulder Bag', 'ms', 'bag', ['camel'], 6900],
  ['Triko Midi Elbise', 'Knit Midi Dress', 'communite', 'dress', ['grey'], 4300],
  ['Gri Flanel Pantolon', 'Grey Flannel Trousers', 'beymen', 'trousers', ['grey'], 3900],
  ['Bej Trençkot', 'Beige Trench Coat', 'ms', 'jacket', ['beige'], 8600],
  ['Siyah Balıkçı Yaka Kazak', 'Black Roll-Neck Jumper', 'lululemon', 'knit', ['black'], 2700],
  ['Bordo Saten Gömlek', 'Burgundy Satin Shirt', 'vakko', 'shirt', ['burgundy'], 3200],
  ['Deri Kemer', 'Leather Belt', 'gap', 'accessory', ['brown'], 1400],
  ['Beyaz Deri Sneaker', 'White Leather Trainers', 'lululemon', 'shoes', ['white'], 5200],
  ['Lacivert Poplin Elbise', 'Navy Poplin Dress', 'ms', 'dress', ['navy'], 4800],
  ['Krem Rengi Kısa Kollu Tişört', 'Cream Short-Sleeve T-Shirt', 'lululemon', 'tshirt', ['cream'], 950],
  ['Hasır Dokulu Tote Çanta', 'Woven Tote Bag', 'communite', 'bag', ['beige'], null],
  ['Kahverengi Kadife Ceket', 'Brown Velvet Jacket', 'beymen', 'jacket', ['brown'], 7400],
  ['Zeytin Kargo Pantolon', 'Olive Cargo Trousers', 'gap', 'trousers', ['olive'], 3100],
  ['Karamel Kaşmir Kazak', 'Camel Cashmere Jumper', 'vakko', 'knit', ['camel'], 6200],
  ['Siyah Topuklu Bot', 'Black Heeled Boots', 'beymen', 'shoes', ['black'], 6800],
  ['Gri Yün Atkı', 'Grey Wool Scarf', 'ms', 'accessory', ['grey'], 1200],
  ['Beyaz Dantelli Gömlek', 'White Lace Shirt', 'communite', 'shirt', ['white'], 3400],
  ['Siyah Deri Clutch', 'Black Leather Clutch', 'vakko', 'bag', ['black'], 5600],
  ['Bej Keten Elbise', 'Beige Linen Dress', 'gap', 'dress', ['beige'], 3700],
  ['Lacivert Polo Tişört', 'Navy Polo Shirt', 'lululemon', 'tshirt', ['navy'], 1300],
];

function sizesFor(category: ProductCategory): string[] {
  if (category === 'shoes') return SHOES;
  if (category === 'bag' || category === 'accessory') return SINGLE;
  return APPAREL;
}

const productId = (index: number) => `prod_${String(index + 1).padStart(3, '0')}`;

/** Newest first: index 0 is the newest product. Names are the Turkish catalogue text. */
export const productsFixture: ProductSummary[] = SEEDS.map(([name, , brandKey, category, colors, price], index) => {
  const brand = BRANDS[brandKey];
  return {
    id: productId(index),
    brandId: brand.id,
    brandName: brand.name,
    brandLogoUrl: brand.logoUrl,
    name,
    price: price === null ? null : lira(price),
    imageUrl: null,
    category,
    colors,
    sizes: sizesFor(category),
  };
});

/** The server localizes catalogue text to `Accept-Language`; the fixtures do the same for the app language. */
const EN_NAMES = new Map(SEEDS.map(([, en], index) => [productId(index), en]));
export function localizedCatalogue(language: string = currentLanguage()): ProductSummary[] {
  if (language !== 'en') return productsFixture;
  return productsFixture.map((p) => ({ ...p, name: EN_NAMES.get(p.id) ?? p.name }));
}

const COLOR_WORDS: Record<CatalogColor, string> = {
  white: 'beyaz white',
  black: 'siyah black',
  navy: 'lacivert navy',
  beige: 'bej beige',
  brown: 'kahverengi brown',
  cream: 'krem cream',
  olive: 'zeytin olive',
  burgundy: 'bordo burgundy',
  grey: 'gri grey',
  camel: 'karamel camel',
};

function fold(value: string): string {
  return value.replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase().trim();
}

/** Catalogue filtering + sorting as the server is expected to do it. Pure. */
export function filterProducts(all: ProductSummary[], query: ProductQuery): ProductSummary[] {
  const q = fold(query.q);
  const matches = all.filter((p) => {
    if (query.categories.length > 0 && !query.categories.includes(p.category)) return false;
    if (query.brandIds.length > 0 && !query.brandIds.includes(p.brandId)) return false;
    if (query.colors.length > 0 && !p.colors.some((c) => query.colors.includes(c))) return false;
    if (query.sizes.length > 0 && !p.sizes.some((s) => query.sizes.includes(s))) return false;
    if (q !== '') {
      const haystack = fold([p.name, p.brandName, ...p.colors.map((c) => COLOR_WORDS[c])].join(' '));
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
  if (query.sort === 'newest') return matches;
  // Products without a published price go last in both price orders.
  return [...matches].sort((a, b) => {
    if (a.price === null || b.price === null) return a.price === null ? (b.price === null ? 0 : 1) : -1;
    return query.sort === 'price_asc' ? a.price.amountMinor - b.price.amountMinor : b.price.amountMinor - a.price.amountMinor;
  });
}

export const PAGE_SIZE = 12;

/** Opaque page token = the next offset. */
export function paginate<T>(items: T[], pageToken: string | null, pageSize: number = PAGE_SIZE): { items: T[]; nextPageToken: string | null } {
  const offset = pageToken ? Number(pageToken) : 0;
  const start = Number.isFinite(offset) && offset > 0 ? offset : 0;
  const end = start + pageSize;
  return { items: items.slice(start, end), nextPageToken: end < items.length ? String(end) : null };
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function currentEdit(today: Date = new Date()): WeeklyEditSummary {
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  return {
    id: 'current',
    title: 'Net Ofis Klasikleri',
    startDate: toIsoDate(monday),
    endDate: toIsoDate(addDays(monday, 6)),
    lookCount: 7,
    imageUrl: null,
  };
}

/** Placeholder creators — sample handles only, no real people (README §9.1 A-7). */
export const creatorsFixture: CreatorCard[] = [
  { id: 'creator_1', handle: 'ornek_stilist', displayName: '@ornek_stilist', role: 'Stil danışmanı', lookTitle: 'Quiet luxury ofis', imageUrl: null, sponsored: false },
  { id: 'creator_2', handle: 'ornek_editor', displayName: '@ornek_editor', role: 'Editör', lookTitle: 'Hafta sonu katman', imageUrl: null, sponsored: false },
  { id: 'creator_3', handle: null, displayName: 'Marka vitrini', role: null, lookTitle: 'Lüks dokunuş', imageUrl: null, sponsored: true },
];

// ---------- In-memory state ----------

type CartRow = { lineId: string; productId: string; size: string };

type State = {
  cart: CartRow[];
  watch: Map<string, { alertEnabled: boolean; source: WatchlistEntry['source']; previousPrice: Money | null }>;
  favorites: Set<string>;
  wardrobeAdds: string[];
};

function initialState(): State {
  return {
    cart: [
      { lineId: 'line_1', productId: 'prod_001', size: 'S' },
      { lineId: 'line_2', productId: 'prod_003', size: '38' },
      { lineId: 'line_3', productId: 'prod_004', size: ONE_SIZE },
    ],
    watch: new Map([
      ['prod_003', { alertEnabled: true, source: { kind: 'look', lookName: 'Beyaz Gömlek, Net Çizgi' }, previousPrice: lira(4125) }],
      ['prod_004', { alertEnabled: true, source: { kind: 'edit' }, previousPrice: null }],
      ['prod_009', { alertEnabled: false, source: { kind: 'manual' }, previousPrice: null }],
    ]),
    favorites: new Set<string>(),
    wardrobeAdds: [],
  };
}

let state = initialState();

/** Test helper: back to the seeded state. */
export function resetStoreFixtures(): void {
  state = initialState();
}

function product(id: string): ProductSummary {
  const found = localizedCatalogue().find((p) => p.id === id);
  if (!found) throw new ApiError('http', 404, { status: 404, code: 'not_found' });
  return found;
}

/** Groups cart rows by brand in first-seen order and prices them with the current catalogue price. Pure. */
export function buildCart(rows: CartRow[], catalogue: ProductSummary[]): Cart {
  const groups: CartGroup[] = [];
  for (const row of rows) {
    const p = catalogue.find((c) => c.id === row.productId);
    if (!p) continue;
    let group = groups.find((g) => g.brandId === p.brandId);
    if (!group) {
      group = { brandId: p.brandId, brandName: p.brandName, brandLogoUrl: p.brandLogoUrl ?? null, subtotal: null, lines: [] };
      groups.push(group);
    }
    group.lines.push({
      lineId: row.lineId,
      productId: p.id,
      name: p.name,
      size: row.size,
      price: p.price,
      imageUrl: p.imageUrl,
      category: p.category,
      color: p.colors[0] ?? null,
    });
  }
  const priced = groups.map((g) => ({ ...g, subtotal: sumMoney(g.lines.map((l) => l.price)) }));
  return {
    groups: priced,
    total: sumMoney(priced.map((g) => g.subtotal)),
    lineCount: priced.reduce((sum, g) => sum + g.lines.length, 0),
  };
}

export const storeFixtures = {
  edit: (): WeeklyEditSummary => currentEdit(),
  creators: (): CreatorCard[] => creatorsFixture,
  series: (): SeriesOutfit[] => [],
  brands: (): Brand[] => brandsFixture,

  products: (query: ProductQuery, pageToken: string | null): ProductPage =>
    paginate(filterProducts(localizedCatalogue(), query), pageToken),
  product: (id: string): ProductDetail => product(id),
  match: (id: string): ProductMatch => {
    const p = product(id);
    const own = slotOfCategory(p.category);
    // The user's real (fixture) wardrobe — the same pieces Gardırop shows.
    const items = fixtureDb.items.filter((w) => slotOfItemCategory(w.category) !== own);
    return {
      count: items.length,
      items: items.map(({ id: itemId, name, imageUrl, category, color }) => ({ id: itemId, name, imageUrl, category, color })),
    };
  },
  complete: (itemId: string): CompleteSuggestions => {
    const piece = fixtureDb.items.find((w) => w.id === itemId);
    const own = piece ? slotOfItemCategory(piece.category) : null;
    return { products: localizedCatalogue().filter((p) => slotOfCategory(p.category) !== own).slice(0, 10) };
  },

  favorites: (): FavoriteProducts => ({ productIds: [...state.favorites] }),
  setFavorite: (productId: string, favorite: boolean): void => {
    if (favorite) state.favorites.add(productId);
    else state.favorites.delete(productId);
  },
  addToWardrobe: (productId: string): void => {
    state.wardrobeAdds.push(productId);
  },

  cart: (): Cart => buildCart(state.cart, localizedCatalogue()),
  addCartLines: (request: AddCartLinesRequest): void => {
    for (const line of request.lines) {
      // Idempotent on clientMutationId, like the server.
      if (state.cart.some((row) => row.lineId === line.clientMutationId)) continue;
      state.cart.push({ lineId: line.clientMutationId, productId: line.productId, size: line.size });
    }
  },
  removeCartLine: (lineId: string): void => {
    state.cart = state.cart.filter((row) => row.lineId !== lineId);
  },
  checkout: (brandId: string): CheckoutResponse => {
    const clickId = `click_${brandId}_${Date.now().toString(36)}`;
    return { checkoutUrl: `https://example.com/checkout/${brandId}?click_id=${clickId}`, clickId };
  },

  watchlist: (): Watchlist => ({
    items: [...state.watch.entries()].map(([productId, entry]): WatchlistEntry => {
      const p = product(productId);
      return {
        productId,
        brandId: p.brandId,
        brandName: p.brandName,
        brandLogoUrl: p.brandLogoUrl ?? null,
        name: p.name,
        price: p.price,
        previousPrice: entry.previousPrice,
        imageUrl: p.imageUrl,
        category: p.category,
        colors: p.colors,
        sizes: p.sizes,
        alertEnabled: entry.alertEnabled,
        source: entry.source,
      };
    }),
  }),
  setWatch: (request: SetWatchRequest): void => {
    if (!request.watching) {
      state.watch.delete(request.productId);
      return;
    }
    const existing = state.watch.get(request.productId);
    state.watch.set(request.productId, {
      alertEnabled: request.alertEnabled,
      source: existing?.source ?? { kind: 'manual' },
      previousPrice: existing?.previousPrice ?? null,
    });
  },
};
