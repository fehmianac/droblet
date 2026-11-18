import { useCartLineCount } from '@/features/store/queries';

/** Cart badge count — the number of lines in the cart (24). */
export function useCartCount() {
  return useCartLineCount();
}
