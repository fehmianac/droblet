import { useQuery } from '@tanstack/react-query';

import { placeholderStoreProducts, type StoreProduct } from '@/fixtures/storeProducts';
import { withLatency } from '@/fixtures/today';
import { queryKeys } from '@/sync/queryKeys';

export type StoreCatalog = {
  /** False until the StoreKit 2 / Play Billing bridge is linked (E10). Purchase/restore are disabled. */
  purchasesAvailable: boolean;
  products: StoreProduct[];
};

/**
 * Store products (price, period, trial). Prices and trial length always come from the store.
 * Until the native billing bridge exists this returns the PLACEHOLDER products from
 * `fixtures/storeProducts.ts` with `purchasesAvailable: false`.
 */
export function useStoreProducts() {
  return useQuery({
    queryKey: queryKeys.storeProducts,
    queryFn: (): Promise<StoreCatalog> =>
      withLatency({ purchasesAvailable: false, products: placeholderStoreProducts }, 600),
    staleTime: 5 * 60_000,
    meta: { persist: false },
  });
}
