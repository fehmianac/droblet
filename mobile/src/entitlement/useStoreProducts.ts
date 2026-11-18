import { useQuery } from '@tanstack/react-query';

import { placeholderStoreProducts, type StoreProduct } from '@/fixtures/storeProducts';
import { fetchStoreProducts } from '@/purchases/billing';
import { queryKeys } from '@/sync/queryKeys';

export type StoreCatalog = {
  /** True when the products came from StoreKit / Play Billing and can be bought. */
  purchasesAvailable: boolean;
  /** 'store' = real products; 'fallback' = the representative fixtures (store returned nothing). */
  source: 'store' | 'fallback';
  products: StoreProduct[];
};

/**
 * Pure: the store's answer → what the paywall / credit sheet show. When the store returns NONE of
 * our products (iOS simulator without the StoreKit configuration file, no Play services, web, tests)
 * the REPRESENTATIVE fixtures are shown so the screen is not empty — and buying is off
 * (`purchasesAvailable: false`), so the user gets the clear "store unavailable" message instead.
 */
export function storeCatalog(products: StoreProduct[]): StoreCatalog {
  if (products.length === 0) return { purchasesAvailable: false, source: 'fallback', products: placeholderStoreProducts };
  return { purchasesAvailable: true, source: 'store', products };
}

/** Store products (localized price, period, eligible free trial) — always from the store, never fixed in screens. */
export function useStoreProducts() {
  return useQuery({
    queryKey: queryKeys.storeProducts,
    queryFn: async (): Promise<StoreCatalog> => storeCatalog(await fetchStoreProducts().catch(() => [])),
    staleTime: 5 * 60_000,
    meta: { persist: false },
  });
}
