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
  ProductPage,
  ProductQuery,
  SeriesOutfit,
  TryOnState,
  WardrobePiece,
  Watchlist,
  WeeklyEditSummary,
} from '@/api/contracts/store';
import { fromSource, queryString } from '@/api/dataSource';
import { isGone } from '@/api/errors';
import { storeFixtures } from '@/fixtures/store';

import { slotCategories } from './slots';

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
  wardrobePieces: ['tenant', 'item', 'pieces'] as const,
  favorites: ['tenant', 'favorite', 'product'] as const,
  tryOn: (productId: string) => ['tenant', 'tryon', 'product', productId] as const,
  cart: ['tenant', 'cart', 'current'] as const,
  watchlist: ['tenant', 'watchlist', 'current'] as const,
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
          return await apiRequest<WeeklyEditSummary>('v1/content/edit/current', { auth: false });
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
    queryFn: () => fromSource('content', storeFixtures.creators, () => apiRequest<CreatorCard[]>('v1/content/creator', { auth: false })),
  });
}

export function useSeriesOutfits(enabled: boolean) {
  return useQuery({
    queryKey: storeKeys.series,
    enabled,
    queryFn: () => fromSource('content', storeFixtures.series, () => apiRequest<SeriesOutfit[]>('v1/content/series-outfit', { auth: false })),
  });
}

// ---------- Catalogue (21–23) ----------

export function useBrands() {
  return useQuery({
    queryKey: storeKeys.brands,
    staleTime: 60 * 60_000,
    queryFn: () => fromSource('catalog', storeFixtures.brands, () => apiRequest<Brand[]>('v1/catalog/brand', { auth: false })),
  });
}

function fetchProducts(query: ProductQuery, pageToken: string | null): Promise<ProductPage> {
  return fromSource(
    'catalog',
    () => storeFixtures.products(query, pageToken),
    () =>
      apiRequest<ProductPage>(
        `v1/catalog/product${queryString({
          category: query.categories,
          brand: query.brandIds,
          color: query.colors,
          size: query.sizes,
          q: query.q.trim(),
          sort: query.sort,
          pageToken,
        })}`,
        { auth: false },
      ),
  );
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

/** 23 — store suggestions for one builder slot (first page is enough for the strip). */
export function useSlotProducts(slot: BuilderSlot | null) {
  const query: ProductQuery = { ...EMPTY_PRODUCT_QUERY, categories: slot ? slotCategories(slot) : [] };
  return useQuery({
    queryKey: [...storeKeys.products(query), 'first-page'] as const,
    enabled: slot !== null,
    queryFn: async () => (await fetchProducts(query, null)).items,
  });
}

/** 22 — product detail. `null` when the product is no longer in the catalogue (404). */
export function useProduct(id: string, enabled = true) {
  return useQuery({
    queryKey: storeKeys.product(id),
    enabled,
    queryFn: async (): Promise<ProductDetail | null> => {
      try {
        return await fromSource('catalog', () => storeFixtures.product(id), () => apiRequest<ProductDetail>(`v1/catalog/product/${id}`, { auth: false }));
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
    queryFn: () => fromSource('catalog', () => storeFixtures.match(id), () => apiRequest<ProductMatch>(`v1/tenant/catalog/product/${id}/match`)),
  });
}

/** 21 "Parçamı tamamla" — products that go with one wardrobe piece. */
export function useCompleteSuggestions(itemId: string | null) {
  return useQuery({
    queryKey: storeKeys.complete(itemId ?? ''),
    enabled: itemId !== null,
    queryFn: () =>
      fromSource(
        'catalog',
        () => storeFixtures.complete(itemId ?? ''),
        () => apiRequest<CompleteSuggestions>('v1/tenant/stylist/complete', { method: 'POST', body: { requestId: itemId, itemIds: [itemId] } }),
      ),
  });
}

/** Wardrobe pieces for 21 "Parçamı tamamla" and the 23 slots. Swap for the shared Gardırop hook once E2 lands. */
export function useWardrobePieces(enabled = true) {
  return useQuery({
    queryKey: storeKeys.wardrobePieces,
    enabled,
    queryFn: () => fromSource('wardrobe', storeFixtures.wardrobe, () => apiRequest<WardrobePiece[]>('v1/tenant/item')),
  });
}

export function useFavoriteProducts() {
  return useQuery({
    queryKey: storeKeys.favorites,
    queryFn: () => fromSource('catalog', storeFixtures.favorites, () => apiRequest<FavoriteProducts>('v1/tenant/favorite/product')),
  });
}

/**
 * 22 "Üzerimde" — the owner's try-on image of a product. Polls while the TryOn worker runs.
 * The signed image URL is short-lived, so this query is never persisted.
 */
export function productTryOnOptions(productId: string) {
  return queryOptions({
    queryKey: storeKeys.tryOn(productId),
    meta: { persist: false },
    queryFn: () =>
      fromSource(
        'tryOn',
        () => storeFixtures.tryOn(productId),
        () => apiRequest<TryOnState>(`v1/tenant/tryon${queryString({ kind: 'product', id: productId })}`),
      ),
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 1500 : false),
  });
}

export function useProductTryOn(productId: string, enabled: boolean) {
  return useQuery({ ...productTryOnOptions(productId), enabled });
}

// ---------- Cart (24) and watchlist (24b) ----------

function fetchCart(): Promise<Cart> {
  return fromSource('cart', storeFixtures.cart, () => apiRequest<Cart>('v1/tenant/cart'));
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
    queryFn: () => fromSource('watchlist', storeFixtures.watchlist, () => apiRequest<Watchlist>('v1/tenant/watchlist')),
  });
}
