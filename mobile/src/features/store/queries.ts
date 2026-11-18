import type { LookSlotKind } from '@/api/contracts/looks';
import { keepPreviousData, queryOptions, useInfiniteQuery, useQuery } from '@tanstack/react-query';

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
  TryOnState,
  Watchlist,
  WeeklyEditSummary,
} from '@/api/contracts/store';
import { fromSource, queryString } from '@/api/dataSource';
import { ApiError, isGone } from '@/api/errors';
import { toJob, type JobWire } from '@/api/wire/core';
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
  toTryOnState,
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
  type TryOnImageWire,
  type WatchItemWire,
} from '@/api/wire/store';
import { storeFixtures } from '@/fixtures/store';

import { localFavorites, mutedWatchAlerts, pendingProductTryOns } from './localState';
import { lookSlotCategories, slotCategories } from './slots';

/** Query keys for E8. Global catalogue/content data and tenant data are kept under separate roots. */
export const storeKeys = {
  edit: ['content', 'edit', 'current'] as const,
  creators: ['content', 'creator'] as const,
  series: ['content', 'series-outfit'] as const,
  brands: ['catalog', 'brand'] as const,
  products: (query: ProductQuery) => ['catalog', 'product', 'list', query] as const,
  product: (id: string) => ['catalog', 'product', 'detail', id] as const,
  match: (id: string) => ['tenant', 'catalog', 'match', id] as const,
  complete: (itemId: string) => ['tenant', 'stylist', 'complete', itemId] as const,
  favorites: ['tenant', 'favorite', 'product'] as const,
  tryOn: (productId: string) => ['tenant', 'tryon', 'product', productId] as const,
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

function fetchProducts(query: ProductQuery, pageToken: string | null): Promise<ProductPage> {
  return fromSource('catalog', () => storeFixtures.products(query, pageToken), () => requestProducts(query, pageToken));
}

/** 21 — paged catalogue (infinite scroll). The previous result stays visible while a new filter loads. */
export function useProducts(query: ProductQuery, enabled = true) {
  return useInfiniteQuery({
    queryKey: storeKeys.products(query),
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchProducts(query, pageParam),
    getNextPageParam: (last) => last.nextPageToken,
    placeholderData: keepPreviousData,
  });
}

/** First catalogue page of some categories — enough for a suggestion strip or a slot picker. */
function useCategoryProducts(categories: ProductCategory[] | null) {
  const query: ProductQuery = { ...EMPTY_PRODUCT_QUERY, categories: categories ?? [] };
  return useQuery({
    queryKey: [...storeKeys.products(query), 'first-page'] as const,
    enabled: categories !== null,
    queryFn: () =>
      fromSource<ProductSummary[]>(
        'catalog',
        () => storeFixtures.products(query, null).items,
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

/** The owner's existing image for the product with the current body photo; `none` when there is none (404). */
async function findProductTryOn(productId: string): Promise<TryOnState> {
  try {
    return toTryOnState(await apiRequest<TryOnImageWire>(`v1/tenant/tryon${queryString({ kind: 'product', id: productId })}`));
  } catch (e) {
    if (isGone(e)) return { status: 'none', imageUrl: null };
    throw e;
  }
}

/** While a job runs for the product: poll it, then read the image it produced. A failed job refunds its credit. */
async function readProductTryOn(productId: string): Promise<TryOnState> {
  const jobId = pendingProductTryOns.get(productId);
  if (!jobId) return findProductTryOn(productId);
  let job;
  try {
    job = await toJob<{ tryOnImageId: string }>(await apiRequest<JobWire>(`v1/tenant/job/${jobId}`));
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      pendingProductTryOns.delete(productId);
      return { status: 'failed', imageUrl: null };
    }
    throw e;
  }
  if (job.status === 'failed') {
    pendingProductTryOns.delete(productId);
    return { status: 'failed', imageUrl: null };
  }
  if (job.status !== 'done' || !job.result) return { status: 'pending', imageUrl: null };
  pendingProductTryOns.delete(productId);
  return toTryOnState(await apiRequest<TryOnImageWire>(`v1/tenant/tryon/${job.result.tryOnImageId}`));
}

/**
 * 22 "Üzerimde" — the owner's try-on image of a product (`GET v1/tenant/tryon?kind=product&id=`).
 * Polls the job while the TryOn worker runs. The signed image URL is short-lived, so this query is
 * never persisted.
 */
export function productTryOnOptions(productId: string) {
  return queryOptions({
    queryKey: storeKeys.tryOn(productId),
    meta: { persist: false },
    queryFn: () => fromSource<TryOnState>('jobs', () => storeFixtures.tryOn(productId), () => readProductTryOn(productId)),
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 1500 : false),
  });
}

export function useProductTryOn(productId: string, enabled: boolean) {
  return useQuery({ ...productTryOnOptions(productId), enabled });
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

export function useWatchlist() {
  return useQuery({
    queryKey: storeKeys.watchlist,
    queryFn: () =>
      fromSource<Watchlist>('watchlist', storeFixtures.watchlist, async () =>
        toWatchlist(await apiRequest<WatchItemWire[]>('v1/tenant/watch-list'), mutedWatchAlerts),
      ),
  });
}

/** Pending "Gardıroba ekleyelim mi?" prompts (`GET v1/tenant/purchase-prompt`), created when a purchase is confirmed. */
export function usePurchasePrompts(enabled = true) {
  return useQuery({
    queryKey: storeKeys.purchasePrompts,
    enabled,
    queryFn: () =>
      fromSource<PurchasePrompt[]>('cart', () => [], async () =>
        (await apiRequest<PurchasePromptWire[]>('v1/tenant/purchase-prompt')).map(toPurchasePrompt),
      ),
  });
}
