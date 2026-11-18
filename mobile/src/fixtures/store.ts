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
  type TryOnState,
  type WardrobePiece,
  type Watchlist,
  type WatchlistEntry,
  type WeeklyEditSummary,
} from '@/api/contracts/store';
import { ApiError } from '@/api/errors';
import { slotOfCategory } from '@/features/store/slots';
import { toIsoDate } from '@/lib/format';
import { sumMoney, type Money } from '@/lib/intl';

/**
 * Typed fixtures for E8 (Keşfet, mağaza, sepet, izleme listesi), used while `DATA_SOURCE` points the
 * feature at 'fixture'. Brand and product names are neutral samples and prices are placeholders —
 * none of them is real catalogue data. The module keeps a small in-memory state so writes
 * (cart, watchlist, favourites) behave like a server within one app session.
 */

export const brandsFixture: Brand[] = [
  { id: 'brand_nord', name: 'Atölye Nord' },
  { id: 'brand_kum', name: 'Maison Kum' },
  { id: 'brand_liman', name: 'Liman' },
  { id: 'brand_sade', name: 'Sade Studio' },
  { id: 'brand_defne', name: 'Defne & Co' },
  { id: 'brand_ada', name: 'Ada Club' },
];

/** Placeholder prices are whole lira amounts; the wire format is minor units + ISO code. */
const lira = (amount: number): Money => ({ amountMinor: amount * 100, currency: 'TRY' });

const APPAREL = ['XS', 'S', 'M', 'L', 'XL'];
const SHOES = ['36', '37', '38', '39', '40'];
const SINGLE = [ONE_SIZE];

type Seed = [name: string, category: ProductCategory, colors: CatalogColor[], price: number | null];

const SEEDS: Seed[] = [
  ['Beyaz Poplin Gömlek', 'shirt', ['white'], 3000],
  ['Yün Karışımlı Blazer', 'jacket', ['navy'], null],
  ['Deri Kroko Babet', 'shoes', ['black'], 3300],
  ['City Medium Siyah Çanta', 'bag', ['black'], 12950],
  ['Krem Triko Kazak', 'knit', ['cream'], 4200],
  ['Yüksek Bel Kumaş Pantolon', 'trousers', ['black'], 3600],
  ['Pamuklu Basic Tişört', 'tshirt', ['white'], 900],
  ['Saten Midi Elbise', 'dress', ['burgundy'], 5400],
  ['Küçük Taşlı Küpe', 'accessory', ['cream'], null],
  ['Keten Oversize Gömlek', 'shirt', ['beige'], 2800],
  ['Karamel Yün Kaban', 'jacket', ['camel'], 9800],
  ['Düz Paça Jean', 'trousers', ['navy'], 2400],
  ['Zeytin Rengi Triko Yelek', 'knit', ['olive'], 2100],
  ['Çizgili Uzun Kollu Tişört', 'tshirt', ['navy', 'white'], 1100],
  ['Süet Loafer', 'shoes', ['brown'], 4700],
  ['İpek Fular', 'accessory', ['burgundy', 'cream'], 1600],
  ['Mini Omuz Çantası', 'bag', ['camel'], 6900],
  ['Triko Midi Elbise', 'dress', ['grey'], 4300],
  ['Gri Flanel Pantolon', 'trousers', ['grey'], 3900],
  ['Bej Trençkot', 'jacket', ['beige'], 8600],
  ['Siyah Balıkçı Yaka Kazak', 'knit', ['black'], 2700],
  ['Bordo Saten Gömlek', 'shirt', ['burgundy'], 3200],
  ['Deri Kemer', 'accessory', ['brown'], 1400],
  ['Beyaz Deri Sneaker', 'shoes', ['white'], 5200],
  ['Lacivert Poplin Elbise', 'dress', ['navy'], 4800],
  ['Krem Rengi Kısa Kollu Tişört', 'tshirt', ['cream'], 950],
  ['Hasır Dokulu Tote Çanta', 'bag', ['beige'], null],
  ['Kahverengi Kadife Ceket', 'jacket', ['brown'], 7400],
  ['Zeytin Kargo Pantolon', 'trousers', ['olive'], 3100],
  ['Karamel Kaşmir Kazak', 'knit', ['camel'], 6200],
  ['Siyah Topuklu Bot', 'shoes', ['black'], 6800],
  ['Gri Yün Atkı', 'accessory', ['grey'], 1200],
  ['Beyaz Dantelli Gömlek', 'shirt', ['white'], 3400],
  ['Siyah Deri Clutch', 'bag', ['black'], 5600],
  ['Bej Keten Elbise', 'dress', ['beige'], 3700],
  ['Lacivert Polo Tişört', 'tshirt', ['navy'], 1300],
];

function sizesFor(category: ProductCategory): string[] {
  if (category === 'shoes') return SHOES;
  if (category === 'bag' || category === 'accessory') return SINGLE;
  return APPAREL;
}

/** Newest first: index 0 is the newest product. */
export const productsFixture: ProductSummary[] = SEEDS.map(([name, category, colors, price], index) => {
  const brand = brandsFixture[index % brandsFixture.length] ?? { id: 'brand_nord', name: 'Atölye Nord' };
  return {
    id: `prod_${String(index + 1).padStart(3, '0')}`,
    brandId: brand.id,
    brandName: brand.name,
    name,
    price: price === null ? null : lira(price),
    imageUrl: null,
    category,
    colors,
    sizes: sizesFor(category),
  };
});

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

export const wardrobeFixture: WardrobePiece[] = [
  { id: 'item_blazer', name: 'Lacivert yün blazer', slot: 'outerwear', imageUrl: null },
  { id: 'item_shirt', name: 'Beyaz poplin gömlek', slot: 'top', imageUrl: null },
  { id: 'item_trousers', name: 'Siyah kumaş pantolon', slot: 'bottom', imageUrl: null },
  { id: 'item_jeans', name: 'Düz jean', slot: 'bottom', imageUrl: null },
  { id: 'item_midi', name: 'Siyah midi elbise', slot: null, imageUrl: null },
  { id: 'item_knit', name: 'Krem triko', slot: 'top', imageUrl: null },
  { id: 'item_flats', name: 'Kroko babet', slot: 'shoes', imageUrl: null },
  { id: 'item_bag', name: 'Siyah deri çanta', slot: 'bag', imageUrl: null },
];

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
  { id: 'creator_2', handle: 'ornek_editor', displayName: 'Stil editörü', role: 'Editör', lookTitle: 'Hafta sonu katman', imageUrl: null, sponsored: false },
  { id: 'creator_3', handle: null, displayName: 'Örnek marka vitrini', role: null, lookTitle: 'Lüks dokunuş', imageUrl: null, sponsored: true },
];

// ---------- In-memory state ----------

type CartRow = { lineId: string; productId: string; size: string };

type State = {
  cart: CartRow[];
  watch: Map<string, { alertEnabled: boolean; source: WatchlistEntry['source']; previousPrice: Money | null }>;
  favorites: Set<string>;
  tryOn: Map<string, { status: TryOnState['status']; readyAt: number }>;
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
    tryOn: new Map(),
    wardrobeAdds: [],
  };
}

let state = initialState();

/** Test helper: back to the seeded state. */
export function resetStoreFixtures(): void {
  state = initialState();
}

function product(id: string): ProductSummary {
  const found = productsFixture.find((p) => p.id === id);
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
      group = { brandId: p.brandId, brandName: p.brandName, subtotal: null, lines: [] };
      groups.push(group);
    }
    group.lines.push({ lineId: row.lineId, productId: p.id, name: p.name, size: row.size, price: p.price, imageUrl: p.imageUrl });
  }
  const priced = groups.map((g) => ({ ...g, subtotal: sumMoney(g.lines.map((l) => l.price)) }));
  return {
    groups: priced,
    total: sumMoney(priced.map((g) => g.subtotal)),
    lineCount: priced.reduce((sum, g) => sum + g.lines.length, 0),
  };
}

const TRY_ON_DURATION_MS = 1500;

export const storeFixtures = {
  edit: (): WeeklyEditSummary => currentEdit(),
  creators: (): CreatorCard[] => creatorsFixture,
  series: (): SeriesOutfit[] => [],
  brands: (): Brand[] => brandsFixture,

  products: (query: ProductQuery, pageToken: string | null): ProductPage =>
    paginate(filterProducts(productsFixture, query), pageToken),
  product: (id: string): ProductDetail => product(id),
  match: (id: string): ProductMatch => {
    const p = product(id);
    const own = slotOfCategory(p.category);
    const items = wardrobeFixture.filter((w) => w.slot !== own);
    return { count: items.length, items: items.map(({ id: itemId, name, imageUrl }) => ({ id: itemId, name, imageUrl })) };
  },
  complete: (itemId: string): CompleteSuggestions => {
    const piece = wardrobeFixture.find((w) => w.id === itemId);
    return { products: productsFixture.filter((p) => slotOfCategory(p.category) !== (piece?.slot ?? null)).slice(0, 10) };
  },
  wardrobe: (): WardrobePiece[] => wardrobeFixture,

  favorites: (): FavoriteProducts => ({ productIds: [...state.favorites] }),
  setFavorite: (productId: string, favorite: boolean): void => {
    if (favorite) state.favorites.add(productId);
    else state.favorites.delete(productId);
  },
  addToWardrobe: (productId: string): void => {
    state.wardrobeAdds.push(productId);
  },

  tryOn: (productId: string): TryOnState => {
    const entry = state.tryOn.get(productId);
    if (!entry) return { status: 'none', imageUrl: null };
    if (entry.status === 'pending' && Date.now() >= entry.readyAt) entry.status = 'done';
    return { status: entry.status, imageUrl: null };
  },
  requestTryOn: (productId: string): void => {
    if (!state.tryOn.has(productId)) {
      state.tryOn.set(productId, { status: 'pending', readyAt: Date.now() + TRY_ON_DURATION_MS });
    }
  },

  cart: (): Cart => buildCart(state.cart, productsFixture),
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
