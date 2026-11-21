import type { LookSlotKind } from '@/api/contracts/looks';
import { keepPreviousData, queryOptions, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type {
  Brand,
  BuilderSlot,
  Cart,
  CompleteSuggestions,
  CreatorCard,
  FavoriteProducts,
  ProductDetail,
  ProductMatch,
  ProductCategory,
  ProductPage,
  ProductQuery,
  ProductSummary,
  PurchasePrompt,
  SeriesOutfit,
  Watchlist,
  WeeklyEditSummary,
} from '@/api/contracts/store';
import { fromSource, queryString } from '@/api/dataSource';
import type { TryOnResult } from '@/api/contracts/tryon';
import { isGone } from '@/api/errors';
import type { ProductWire } from '@/api/wire/catalog';
import {
  fromProductCategory,
  fromProductSort,
  splitProductQuery,
  toBrand,
  toCart,
  toCompleteSuggestions,
  toCreatorCard,
  toProductMatch,
  toProductPage,
  toProductSummary,
  toPurchasePrompt,
  toSeriesOutfit,
  toWatchlist,
  toWeeklyEditSummary,
  type BrandWire,
  type CartWire,
  type CompleteWire,
  type ContentCollectionWire,
  type EditWire,
  type ProductMatchWire,
  type ProductPageWire,
  type PurchasePromptWire,
  type WatchItemWire,
} from '@/api/wire/store';
import { cachedTryOnJobId, requestExistingTryOn } from '@/api/wire/tryon';
import { storeFixtures } from '@/fixtures/store';

import { localFavorites } from './localState';
import { productCategoriesFor } from '@/features/segment/catalog';
import { useSegment } from '@/features/segment/store';

import { lookSlotCategories, slotCategories } from './slots';

/** Query keys for E8. Global catalogue/content data and tenant data are kept under separate roots. */
export const storeKeys = {
  /** Keşfet cover (`WeeklyEditSummary`) — never under `planKeys.edits` (the 08 detail, another shape). */
  edit: ['content', 'edit', 'summary', 'current'] as const,
  creators: ['content', 'creator'] as const,
  series: ['content', 'series-outfit'] as const,
  brands: ['catalog', 'brand'] as const,
  /** The catalogue of one segment: the server lists the user's segment plus unisex (docs/api/segments.md §5). */
  products: (query: ProductQuery, segment: 'women' | 'men' = 'women') => ['catalog', 'product', 'list', segment, query] as const,
  product: (id: string) => ['catalog', 'product', 'detail', id] as const,
  match: (id: string) => ['tenant', 'catalog', 'match', id] as const,
  complete: (itemId: string) => ['tenant', 'stylist', 'complete', itemId] as const,
  favorites: ['tenant', 'favorite', 'product'] as const,
  tryOnJob: (productId: string) => ['tenant', 'tryon', 'product', productId, 'job'] as const,
  cart: ['tenant', 'cart', 'current'] as const,
  watchlist: ['tenant', 'watchlist', 'current'] as const,
  purchasePrompts: ['tenant', 'purchase-prompt'] as const,
};

export const EMPTY_PRODUCT_QUERY: ProductQuery = { categories: [], brandIds: [], colors: [], sizes: [], q: '', sort: 'newest' };

// ---------- Content (20) ----------

/** 20 — weekly edit cover. `null` when no edit is published. */
export function useCurrentEdit() {
  return useQuery({
    queryKey: storeKeys.edit,
    queryFn: () =>
      fromSource<WeeklyEditSummary | null>('content', storeFixtures.edit, async () => {
        try {
          return toWeeklyEditSummary(await apiRequest<EditWire>('v1/content/edit/current'));
        } catch (e) {
          if (isGone(e)) return null;
          throw e;
        }
      }),
  });
}

/** 20 / 27 — creators (placeholder names until agreements exist, A-7). */
export function useCreators() {
  return useQuery({
    queryKey: storeKeys.creators,
    queryFn: () =>
      fromSource<CreatorCard[]>('content', storeFixtures.creators, async () =>
        (await apiRequest<ContentCollectionWire[]>('v1/content/creator')).map(toCreatorCard),
      ),
  });
}

export function useSeriesOutfits(enabled: boolean) {
  return useQuery({
    queryKey: storeKeys.series,
    enabled,
    queryFn: () =>
      fromSource<SeriesOutfit[]>('content', storeFixtures.series, async () =>
        (await apiRequest<ContentCollectionWire[]>('v1/content/series-outfit')).map(toSeriesOutfit),
      ),
  });
}

// ---------- Catalogue (21–23) ----------

export function useBrands() {
  return useQuery({
    queryKey: storeKeys.brands,
    staleTime: 60 * 60_000,
    queryFn: () =>
      fromSource<Brand[]>('catalog', storeFixtures.brands, async () => (await apiRequest<BrandWire[]>('v1/catalog/brand')).map(toBrand)),
  });
}

/** One catalogue page. Single-valued filters go to the server, multi-valued ones are applied here (see `ProductQuery`). */
async function requestProducts(query: ProductQuery, pageToken: string | null, limit?: number): Promise<ProductPage> {
  const { server, local } = splitProductQuery(query);
  const wire = await apiRequest<ProductPageWire>(
    `v1/catalog/product${queryString({ ...server, q: query.q.trim().slice(0, 80), sort: fromProductSort(query.sort), pageToken, limit })}`,
  );
  return toProductPage(wire, local);
}

function fetchProducts(query: ProductQuery, pageToken: string | null, segment: 'women' | 'men'): Promise<ProductPage> {
  return fromSource('catalog', () => storeFixtures.products(query, pageToken, segment), () => requestProducts(query, pageToken));
}

/** 21 — paged catalogue (infinite scroll) of the user's segment. The previous result stays visible while a new filter loads. */
export function useProducts(query: ProductQuery, enabled = true) {
  const segment = useSegment();
  return useInfiniteQuery({
    queryKey: storeKeys.products(query, segment),
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchProducts(query, pageParam, segment),
    getNextPageParam: (last) => last.nextPageToken,
    placeholderData: keepPreviousData,
  });
}

/** First catalogue page of some categories — enough for a suggestion strip or a slot picker. */
function useCategoryProducts(slotCategories: ProductCategory[] | null) {
  const segment = useSegment();
  const categories = slotCategories ? productCategoriesFor(segment, slotCategories) : null;
  const query: ProductQuery = { ...EMPTY_PRODUCT_QUERY, categories: categories ?? [] };
  return useQuery({
    queryKey: [...storeKeys.products(query, segment), 'first-page'] as const,
    enabled: categories !== null,
    queryFn: () =>
      fromSource<ProductSummary[]>(
        'catalog',
        () => storeFixtures.products(query, null, segment).items,
        async () => {
          // The server filters one category per request: one first page per category, merged in slot order.
          const pages = await Promise.all(
            (categories ?? []).map((category) =>
              apiRequest<ProductPageWire>(`v1/catalog/product${queryString({ category: fromProductCategory(category), limit: 24 })}`),
            ),
          );
          return pages.flatMap((page) => page.items.map(toProductSummary));
        },
      ),
  });
}

/** 23 — store suggestions for one builder slot. */
export function useSlotProducts(slot: BuilderSlot | null) {
  return useCategoryProducts(slot ? slotCategories(slot) : null);
}

/** 15 Look oluştur, "Mağaza" tab — catalogue pieces that can fill one look slot. */
export function useLookSlotProducts(slot: LookSlotKind | null) {
  return useCategoryProducts(slot ? lookSlotCategories(slot) : null);
}

/** 22 — product detail. `null` when the product is no longer in the catalogue (404). */
export function useProduct(id: string, enabled = true) {
  return useQuery({
    queryKey: storeKeys.product(id),
    enabled,
    queryFn: async (): Promise<ProductDetail | null> => {
      try {
        return await fromSource<ProductDetail>(
          'catalog',
          () => storeFixtures.product(id),
          async () => toProductSummary(await apiRequest<ProductWire>(`v1/catalog/product/${encodeURIComponent(id)}`)),
        );
      } catch (e) {
        if (isGone(e)) return null;
        throw e;
      }
    },
  });
}

/** 22 — "Gardırobundaki N parçayla uyumlu". */
export function useProductMatch(id: string) {
  return useQuery({
    queryKey: storeKeys.match(id),
    queryFn: () =>
      fromSource<ProductMatch>(
        'catalog',
        () => storeFixtures.match(id),
        async () => toProductMatch(await apiRequest<ProductMatchWire>(`v1/tenant/catalog/product/${encodeURIComponent(id)}/match`)),
      ),
  });
}

/** 21 "Parçamı tamamla" — products that go with one wardrobe piece. */
export function useCompleteSuggestions(itemId: string | null) {
  return useQuery({
    queryKey: storeKeys.complete(itemId ?? ''),
    enabled: itemId !== null,
    queryFn: () =>
      fromSource<CompleteSuggestions>(
        'catalog',
        () => storeFixtures.complete(itemId ?? ''),
        // Synchronous and rule based (`POST v1/tenant/catalog/complete`) — not an AI job, no credit.
        async () =>
          toCompleteSuggestions(await apiRequest<CompleteWire>('v1/tenant/catalog/complete', { method: 'POST', body: { itemIds: [itemId] } })),
      ),
  });
}

export function useFavoriteProducts() {
  return useQuery({
    queryKey: storeKeys.favorites,
    queryFn: () =>
      fromSource<FavoriteProducts>('catalog', storeFixtures.favorites, async () => {
        try {
          return await apiRequest<FavoriteProducts>('v1/tenant/favorite/product');
        } catch (e) {
          // The endpoint is newer than some deployed backends: until it exists the hearts live on the device.
          if (isGone(e)) return { productIds: [...localFavorites] };
          throw e;
        }
      }),
  });
}

/**
 * 22 "Üzerimde" — the id of the try-on job started for a product in this session, so coming back to
 * the product shows the same image (or the same wait) instead of spending another credit. The job
 * itself is started and polled with the shared `useStartTryOn` / `useTryOnJob` (features/tryon).
 * Never persisted: a job and its signed image URL do not outlive the session.
 */
function productTryOnJobOptions(productId: string) {
  return queryOptions({
    queryKey: storeKeys.tryOnJob(productId),
    meta: { persist: false },
    staleTime: Infinity,
    // Client-held state: a refetch (e.g. a broad invalidation) answers with what is already known.
    // The first read asks the server for an image the owner already has of the product
    // (`GET v1/tenant/tryon?kind=product&id=`, 404 = none): it opens without spending a credit.
    queryFn: async ({ client, queryKey }) => {
      const known = client.getQueryData<string | null>(queryKey);
      if (known) return known;
      const existing = await fromSource<TryOnResult | null>('jobs', () => null, () => requestExistingTryOn({ kind: 'product', id: productId }));
      return existing ? cachedTryOnJobId(existing.tryOnId) : null;
    },
  });
}

export function useProductTryOnJobId(productId: string): [jobId: string | null, remember: (jobId: string | null) => void] {
  const client = useQueryClient();
  const options = productTryOnJobOptions(productId);
  const query = useQuery(options);
  return [query.data ?? null, (jobId) => client.setQueryData(options.queryKey, jobId)];
}

// ---------- Cart (24) and watchlist (24b) ----------

function fetchCart(): Promise<Cart> {
  return fromSource<Cart>('cart', storeFixtures.cart, async () => toCart(await apiRequest<CartWire>('v1/tenant/cart')));
}

export function useCart() {
  return useQuery({ queryKey: storeKeys.cart, queryFn: fetchCart });
}

/** Cart badge on 20 / 21 / 22 / 24b — derived from the cart itself. */
export function useCartLineCount() {
  return useQuery({ queryKey: storeKeys.cart, queryFn: fetchCart, select: (cart) => cart.lineCount });
}

export function useWatchlist(enabled = true) {
  return useQuery({
    queryKey: storeKeys.watchlist,
    enabled,
    queryFn: () =>
      fromSource<Watchlist>('watchlist', storeFixtures.watchlist, async () =>
        toWatchlist(await apiRequest<WatchItemWire[]>('v1/tenant/watch-list')),
      ),
  });
}

/** Pending "Gardıroba ekleyelim mi?" prompts (`GET v1/tenant/purchase-prompt`), created when a purchase is confirmed. */
export function usePurchasePrompts(enabled = true) {
  return useQuery({
    queryKey: storeKeys.purchasePrompts,
    enabled,
    // "On the next app open": read again whenever the app comes to the foreground.
    refetchOnWindowFocus: 'always',
    meta: { persist: false },
    queryFn: () =>
      fromSource<PurchasePrompt[]>('cart', () => [], async () =>
        (await apiRequest<PurchasePromptWire[]>('v1/tenant/purchase-prompt')).map(toPurchasePrompt),
      ),
  });
}
