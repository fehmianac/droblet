import { useMutation, type QueryClient } from '@tanstack/react-query';

import { track } from '@/analytics/track';
import { apiRequest } from '@/api/client';
import type {
  AddCartLinesRequest,
  AddItemFromProductRequest,
  Cart,
  CheckoutResponse,
  CreateLookRequest,
  FavoriteProducts,
  ProductSize,
  ProductSummary,
  RemoveCartLineRequest,
  SetFavoriteRequest,
  SetWatchRequest,
  TryOnRequest,
  TryOnState,
  Watchlist,
  WatchlistEntry,
} from '@/api/contracts/store';
import { fromSource } from '@/api/dataSource';
import { isGone } from '@/api/errors';
import { openCreditSheetIfExhausted } from '@/features/credits/creditSheetStore';
import { storeFixtures } from '@/fixtures/store';
import { ulid } from '@/lib/ids';
import { newClientMutation } from '@/sync/clientMutation';
import { queryKeys, TENANT_WRITE_SCOPE } from '@/sync/queryKeys';

import { addLinesToCart, removeLineFromCart, type NewCartLine } from './cartMath';
import { storeKeys } from './queries';

export const storeMutationKeys = {
  setFavorite: ['tenant', 'favorite', 'product', 'set'] as const,
  addItemFromProduct: ['tenant', 'item', 'from-product'] as const,
  requestTryOn: ['tenant', 'tryon', 'request'] as const,
  createLook: ['tenant', 'look', 'create-from-builder'] as const,
  addCartLines: ['tenant', 'cart', 'line', 'add'] as const,
  removeCartLine: ['tenant', 'cart', 'line', 'remove'] as const,
  setWatch: ['tenant', 'watchlist', 'set'] as const,
};

/** Queued variables keep the product next to the wire fields so the optimistic cart can be rebuilt. */
type AddToCartVariables = { lines: NewCartLine[] };
type SetWatchVariables = SetWatchRequest & { product: ProductSummary | null };

/** Registers the function + optimistic update of every queued E8 write (see `sync/mutationFns`). */
export function registerStoreMutations(client: QueryClient): void {
  client.setMutationDefaults(storeMutationKeys.setFavorite, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: SetFavoriteRequest) =>
      fromSource(
        'catalog',
        () => storeFixtures.setFavorite(vars.productId, vars.favorite),
        () => apiRequest<void>(`v1/tenant/favorite/product/${vars.productId}`, { method: 'PUT', body: vars }),
      ),
    onMutate: async (vars: SetFavoriteRequest) => {
      await client.cancelQueries({ queryKey: storeKeys.favorites });
      client.setQueryData<FavoriteProducts>(storeKeys.favorites, (prev) => {
        const ids = (prev?.productIds ?? []).filter((id) => id !== vars.productId);
        return { productIds: vars.favorite ? [...ids, vars.productId] : ids };
      });
    },
    onError: () => void client.invalidateQueries({ queryKey: storeKeys.favorites }),
  });

  client.setMutationDefaults(storeMutationKeys.addItemFromProduct, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: AddItemFromProductRequest) =>
      fromSource(
        'wardrobe',
        () => storeFixtures.addToWardrobe(vars.productId),
        () => apiRequest<void>('v1/tenant/item/from-product', { method: 'POST', body: vars }),
      ),
    onSuccess: () => void client.invalidateQueries({ queryKey: storeKeys.wardrobePieces }),
  });

  client.setMutationDefaults(storeMutationKeys.requestTryOn, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: TryOnRequest) =>
      fromSource(
        'tryOn',
        () => storeFixtures.requestTryOn(vars.target.id),
        () => apiRequest<void>('v1/tenant/tryon', { method: 'POST', body: vars }),
      ),
    onMutate: async (vars: TryOnRequest) => {
      const key = storeKeys.tryOn(vars.target.id);
      await client.cancelQueries({ queryKey: key });
      client.setQueryData<TryOnState>(key, { status: 'pending', imageUrl: null });
    },
    onSuccess: (_data: void, vars: TryOnRequest) => {
      track('credit_spent', { feature: 'product_try_on' });
      void client.invalidateQueries({ queryKey: storeKeys.tryOn(vars.target.id) });
      void client.invalidateQueries({ queryKey: queryKeys.entitlement });
    },
    onError: (error: unknown, vars: TryOnRequest) => {
      // Out of credits → 05b sheet (not the paywall); the toggle falls back to the product photo.
      const exhausted = openCreditSheetIfExhausted(error, 'product_try_on');
      client.setQueryData<TryOnState>(storeKeys.tryOn(vars.target.id), {
        status: exhausted ? 'none' : 'failed',
        imageUrl: null,
      });
    },
  });

  client.setMutationDefaults(storeMutationKeys.createLook, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: CreateLookRequest) =>
      fromSource('wardrobe', () => undefined, () => apiRequest<void>('v1/tenant/look', { method: 'POST', body: vars })),
  });

  client.setMutationDefaults(storeMutationKeys.addCartLines, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: AddToCartVariables) => {
      const body: AddCartLinesRequest = {
        lines: vars.lines.map((l) => ({ clientMutationId: l.clientMutationId, productId: l.product.id, size: l.size })),
      };
      return fromSource('cart', () => storeFixtures.addCartLines(body), () => apiRequest<void>('v1/tenant/cart/line', { method: 'POST', body }));
    },
    onMutate: async (vars: AddToCartVariables) => {
      await client.cancelQueries({ queryKey: storeKeys.cart });
      client.setQueryData<Cart>(storeKeys.cart, (prev) => addLinesToCart(prev, vars.lines));
    },
    onSettled: () => void client.invalidateQueries({ queryKey: storeKeys.cart }),
  });

  client.setMutationDefaults(storeMutationKeys.removeCartLine, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: async (vars: RemoveCartLineRequest) => {
      try {
        await fromSource(
          'cart',
          () => storeFixtures.removeCartLine(vars.lineId),
          () => apiRequest<void>(`v1/tenant/cart/line/${vars.lineId}`, { method: 'DELETE' }),
        );
      } catch (e) {
        // Already gone on the server (removed on another device): the wanted end state is reached.
        if (!isGone(e)) throw e;
      }
    },
    onMutate: async (vars: RemoveCartLineRequest) => {
      await client.cancelQueries({ queryKey: storeKeys.cart });
      client.setQueryData<Cart>(storeKeys.cart, (prev) => (prev ? removeLineFromCart(prev, vars.lineId) : prev));
    },
    onSettled: () => void client.invalidateQueries({ queryKey: storeKeys.cart }),
  });

  client.setMutationDefaults(storeMutationKeys.setWatch, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: ({ product: _product, ...request }: SetWatchVariables) => {
      void _product;
      return fromSource(
        'watchlist',
        () => storeFixtures.setWatch(request),
        () =>
          request.watching
            ? apiRequest<void>(`v1/tenant/watchlist/${request.productId}`, { method: 'PUT', body: request })
            : apiRequest<void>(`v1/tenant/watchlist/${request.productId}`, { method: 'DELETE' }),
      );
    },
    onMutate: async (vars: SetWatchVariables) => {
      await client.cancelQueries({ queryKey: storeKeys.watchlist });
      client.setQueryData<Watchlist>(storeKeys.watchlist, (prev) => {
        const items = prev?.items ?? [];
        if (!vars.watching) return { items: items.filter((i) => i.productId !== vars.productId) };
        const existing = items.find((i) => i.productId === vars.productId);
        if (existing) {
          return { items: items.map((i) => (i === existing ? { ...i, alertEnabled: vars.alertEnabled } : i)) };
        }
        if (!vars.product) return prev;
        const entry: WatchlistEntry = {
          productId: vars.product.id,
          brandId: vars.product.brandId,
          brandName: vars.product.brandName,
          name: vars.product.name,
          price: vars.product.price,
          previousPrice: null,
          imageUrl: vars.product.imageUrl,
          category: vars.product.category,
          colors: vars.product.colors,
          sizes: vars.product.sizes,
          alertEnabled: vars.alertEnabled,
          source: { kind: 'manual' },
        };
        return { items: [...items, entry] };
      });
    },
    onSettled: () => void client.invalidateQueries({ queryKey: storeKeys.watchlist }),
  });
}

// ---------- Hooks ----------

export function useSetFavorite() {
  const m = useMutation<void, unknown, SetFavoriteRequest>({ mutationKey: storeMutationKeys.setFavorite });
  return (productId: string, favorite: boolean) =>
    m.mutate({ productId, favorite, clientMutationId: newClientMutation().clientMutationId });
}

export function useAddItemFromProduct() {
  const m = useMutation<void, unknown, AddItemFromProductRequest>({ mutationKey: storeMutationKeys.addItemFromProduct });
  return (productId: string, size: ProductSize) =>
    m.mutate({ productId, size, clientMutationId: newClientMutation().clientMutationId });
}

export function useRequestTryOn() {
  const m = useMutation<void, unknown, TryOnRequest>({ mutationKey: storeMutationKeys.requestTryOn });
  return (productId: string) => {
    const id = ulid();
    m.mutate({ requestId: id, clientMutationId: id, target: { kind: 'product', id: productId } });
  };
}

export function useCreateLook() {
  const m = useMutation<void, unknown, CreateLookRequest>({ mutationKey: storeMutationKeys.createLook });
  return (look: Omit<CreateLookRequest, 'id' | 'clientMutationId'>) =>
    m.mutate({ ...look, id: ulid(), clientMutationId: newClientMutation().clientMutationId });
}

/** "Sepete ekle" / "N ürünü satın al" — one queued write for all lines; tracks `cart_added` per product. */
export function useAddToCart() {
  const m = useMutation<void, unknown, AddToCartVariables>({ mutationKey: storeMutationKeys.addCartLines });
  return (items: { product: ProductSummary; size: ProductSize }[], source: string) => {
    if (items.length === 0) return;
    m.mutate({ lines: items.map((i) => ({ ...i, clientMutationId: ulid() })) });
    items.forEach((i) => track('cart_added', { productId: i.product.id, brandId: i.product.brandId, source }));
  };
}

export function useRemoveCartLine() {
  const m = useMutation<void, unknown, RemoveCartLineRequest>({ mutationKey: storeMutationKeys.removeCartLine });
  return (lineId: string) => m.mutate({ lineId, clientMutationId: newClientMutation().clientMutationId });
}

export function useSetWatch() {
  const m = useMutation<void, unknown, SetWatchVariables>({ mutationKey: storeMutationKeys.setWatch });
  return (vars: { productId: string; watching: boolean; alertEnabled: boolean; product?: ProductSummary }) =>
    m.mutate({
      productId: vars.productId,
      watching: vars.watching,
      alertEnabled: vars.alertEnabled,
      product: vars.product ?? null,
      clientMutationId: newClientMutation().clientMutationId,
    });
}

/**
 * "[Marka]'da öde" — asks the server for the brand's checkout link. Interactive and online-only:
 * the link is needed right now to open the in-app browser, so it is not queued.
 */
export function useBrandCheckout() {
  return useMutation({
    mutationFn: (brandId: string) =>
      fromSource(
        'cart',
        () => storeFixtures.checkout(brandId),
        () =>
          apiRequest<CheckoutResponse>(`v1/tenant/cart/checkout/${brandId}`, {
            method: 'POST',
            body: { clientMutationId: newClientMutation().clientMutationId },
          }),
      ),
    networkMode: 'always',
    retry: false,
  });
}
