import { wardrobeKeys } from '@/features/wardrobe/queries';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

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
  StoreLookRef,
  Watchlist,
  WatchlistEntry,
} from '@/api/contracts/store';
import { fromSource } from '@/api/dataSource';
import { apiErrorCode, isGone } from '@/api/errors';
import {
  fromBuilderLook,
  fromCartLine,
  fromProductSize,
  toCart,
  toCheckout,
  type CartWire,
  type CheckoutWire,
  type ItemCreateResultWire,
  type PurchasePromptAnswerWire,
} from '@/api/wire/store';
import type { LookWire } from '@/api/wire/wardrobe';
import { storeFixtures } from '@/fixtures/store';
import { ulid } from '@/lib/ids';
import { newClientMutation } from '@/sync/clientMutation';
import { TENANT_WRITE_SCOPE } from '@/sync/queryKeys';

import { addLinesToCart, removeLineFromCart, type NewCartLine } from './cartMath';
import { localFavorites } from './localState';
import { storeKeys } from './queries';

export const storeMutationKeys = {
  setFavorite: ['tenant', 'favorite', 'product', 'set'] as const,
  addItemFromProduct: ['tenant', 'item', 'from-product'] as const,
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
        async () => {
          const path = `v1/tenant/favorite/product/${encodeURIComponent(vars.productId)}`;
          try {
            await apiRequest<void>(path, { method: vars.favorite ? 'PUT' : 'DELETE' });
          } catch (e) {
            // 404 `product_not_found` is a real refusal. A bare 404 means the backend in front of the app
            // does not have the favourites endpoints yet: the heart is then kept on the device.
            if (!isGone(e) || apiErrorCode(e) === 'product_not_found') {
              if (isGone(e) && !vars.favorite) return;
              throw e;
            }
            if (vars.favorite) localFavorites.add(vars.productId);
            else localFavorites.delete(vars.productId);
          }
        },
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
        async () => {
          const size = fromProductSize(vars.size);
          const body = { clientMutationId: vars.clientMutationId, productId: vars.productId, ...(size ? { size } : {}) };
          // 201 created / 200 replay, one result row either way.
          await apiRequest<ItemCreateResultWire>('v1/tenant/item/from-product', { method: 'POST', body });
        },
      ),
    onSuccess: () => void client.invalidateQueries({ queryKey: wardrobeKeys.items }),
  });

  client.setMutationDefaults(storeMutationKeys.createLook, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: CreateLookRequest) =>
      fromSource<void>('wardrobe', () => undefined, async () => {
        // 201 created / 200 when the same id was already saved (a retried write).
        await apiRequest<LookWire>('v1/tenant/look', { method: 'POST', body: fromBuilderLook(vars) });
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['tenant', 'look'] }),
  });

  client.setMutationDefaults(storeMutationKeys.addCartLines, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: AddToCartVariables) => {
      const body: AddCartLinesRequest = {
        lines: vars.lines.map((l) => ({ clientMutationId: l.clientMutationId, productId: l.product.id, size: l.size, look: l.look })),
      };
      return fromSource<void>(
        'cart',
        () => storeFixtures.addCartLines(body),
        async () => {
          // All or nothing; answers with the whole cart, which replaces the optimistic one.
          const cart = await apiRequest<CartWire>('v1/tenant/cart/line', { method: 'POST', body: { lines: body.lines.map(fromCartLine) } });
          client.setQueryData<Cart>(storeKeys.cart, toCart(cart));
        },
      );
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
          () => apiRequest<void>(`v1/tenant/cart/line/${encodeURIComponent(vars.lineId)}`, { method: 'DELETE' }),
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
        async () => {
          const path = `v1/tenant/watch-list/${encodeURIComponent(request.productId)}`;
          if (!request.watching) {
            try {
              await apiRequest<void>(path, { method: 'DELETE' });
            } catch (e) {
              // Not on the list any more: the wanted end state is reached.
              if (!isGone(e)) throw e;
            }
            return;
          }
          const size = fromProductSize(request.size);
          // PUT is an upsert: on an entry already watched only the sent fields change (the bell = `notify`).
          await apiRequest<unknown>(path, {
            method: 'PUT',
            body: { ...(size ? { size } : {}), ...(request.look ? { look: request.look } : {}), notify: request.alertEnabled },
          });
        },
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
          brandLogoUrl: vars.product.brandLogoUrl ?? null,
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

export function useCreateLook() {
  const m = useMutation<void, unknown, CreateLookRequest>({ mutationKey: storeMutationKeys.createLook });
  return (look: Omit<CreateLookRequest, 'id' | 'clientMutationId'>) =>
    m.mutate({ ...look, id: ulid(), clientMutationId: newClientMutation().clientMutationId });
}

/** "Sepete ekle" / "N ürünü satın al" — one queued write for all lines; tracks `cart_added` per product. */
export function useAddToCart() {
  const m = useMutation<void, unknown, AddToCartVariables>({ mutationKey: storeMutationKeys.addCartLines });
  return (items: { product: ProductSummary; size: ProductSize }[], source: string, look?: StoreLookRef) => {
    if (items.length === 0) return;
    m.mutate({ lines: items.map((i) => ({ ...i, look, clientMutationId: ulid() })) });
    items.forEach((i) => track('cart_added', { productId: i.product.id, brandId: i.product.brandId, source }));
  };
}

export function useRemoveCartLine() {
  const m = useMutation<void, unknown, RemoveCartLineRequest>({ mutationKey: storeMutationKeys.removeCartLine });
  return (lineId: string) => m.mutate({ lineId, clientMutationId: newClientMutation().clientMutationId });
}

export function useSetWatch() {
  const m = useMutation<void, unknown, SetWatchVariables>({ mutationKey: storeMutationKeys.setWatch });
  return (vars: {
    productId: string;
    watching: boolean;
    alertEnabled: boolean;
    product?: ProductSummary;
    size?: ProductSize;
    /** Where the product was seen, e.g. `{ kind: 'edit', id: editLookId }` from the weekly edit. */
    look?: StoreLookRef;
  }) =>
    m.mutate({
      productId: vars.productId,
      watching: vars.watching,
      alertEnabled: vars.alertEnabled,
      product: vars.product ?? null,
      size: vars.size,
      look: vars.look,
      clientMutationId: newClientMutation().clientMutationId,
    });
}

/**
 * "[Marka]'da öde" — asks the server for the brand's checkout link (`POST v1/tenant/cart/checkout/{brandId}`,
 * no body). Interactive and online-only: the link is needed right now to open the in-app browser, so
 * it is not queued. The server records the click; the cart is not emptied.
 */
export function useBrandCheckout() {
  return useMutation({
    mutationFn: (brandId: string) =>
      fromSource<CheckoutResponse>(
        'cart',
        () => storeFixtures.checkout(brandId),
        async () => toCheckout(await apiRequest<CheckoutWire>(`v1/tenant/cart/checkout/${encodeURIComponent(brandId)}`, { method: 'POST' })),
      ),
    networkMode: 'always',
    retry: false,
  });
}

/** Opens one product on the brand site without the cart (`POST v1/tenant/catalog/product/{id}/checkout`). */
export function useProductCheckout() {
  return useMutation({
    mutationFn: (vars: { productId: string; look?: StoreLookRef }) =>
      fromSource<CheckoutResponse>(
        'cart',
        () => storeFixtures.checkout(vars.productId),
        async () =>
          toCheckout(
            await apiRequest<CheckoutWire>(`v1/tenant/catalog/product/${encodeURIComponent(vars.productId)}/checkout`, {
              method: 'POST',
              body: vars.look ? { look: vars.look } : {},
            }),
          ),
      ),
    networkMode: 'always',
    retry: false,
  });
}

/**
 * Answers a "Gardıroba ekleyelim mi?" prompt (`PUT v1/tenant/purchase-prompt/{id} { accepted }`). The
 * server adds the purchased pieces itself and the call is idempotent — the app must not also call
 * `item/from-product`. 403 `premium_required` leaves the prompt pending.
 */
export function useAnswerPurchasePrompt() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; accepted: boolean }) =>
      fromSource<void>('cart', () => undefined, async () => {
        await apiRequest<PurchasePromptAnswerWire>(`v1/tenant/purchase-prompt/${encodeURIComponent(vars.id)}`, {
          method: 'PUT',
          body: { accepted: vars.accepted },
        });
      }),
    onSuccess: (_data, vars) => {
      void client.invalidateQueries({ queryKey: storeKeys.purchasePrompts });
      if (vars.accepted) void client.invalidateQueries({ queryKey: wardrobeKeys.items });
    },
  });
}
