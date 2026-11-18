import { useQuery } from '@tanstack/react-query';

import { cartCountFixture } from '@/fixtures/cart';
import { withLatency } from '@/fixtures/today';

/** Cart badge count — fixture-backed until the E8 cart contract exists. */
export function useCartCount() {
  return useQuery({ queryKey: ['tenant', 'cart', 'count'], queryFn: () => withLatency(cartCountFixture, 100) });
}
