import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { track } from '@/analytics/track';
import type { ProductSummary } from '@/api/contracts/store';
import { useProductCheckout } from '@/features/store/mutations';
import { useIsOnline } from '@/sync/network';
import { useThemeColors } from '@/theme/useThemeColors';

export type BuySource = { source: 'post' | 'story'; postId?: string };

/**
 * "Satın al" of Akış: asks the server for the product's brand link (`POST v1/tenant/catalog/product/{id}/checkout`,
 * which records the click, attributed to the post) and opens it in the in-app browser — the same way "[Marka]'da öde" opens the cart's
 * brand checkout. Droblet never takes the payment. Online only; a failure is one calm sentence.
 */
export function useOpenOnBrandSite() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const online = useIsOnline();
  const checkout = useProductCheckout();
  const [error, setError] = useState<{ productId: string; message: string } | null>(null);

  const open = async (product: Pick<ProductSummary, 'id' | 'brandId'>, from: BuySource) => {
    setError(null);
    if (!online) {
      setError({ productId: product.id, message: t('homeFeed.buySheet.offline') });
      return;
    }
    try {
      // A post's buy click is attributed to that post (affiliate reports); a story has no post.
      const look = from.postId ? { kind: 'feedPost' as const, id: from.postId } : undefined;
      const { checkoutUrl } = await checkout.mutateAsync({ productId: product.id, ...(look ? { look } : {}) });
      // Only ever hand a web link to the browser.
      if (!/^https:\/\//i.test(checkoutUrl)) throw new Error('unexpected checkout url');
      track('feed_buy_click', { productId: product.id, brandId: product.brandId, source: from.source, postId: from.postId ?? null });
      await WebBrowser.openBrowserAsync(checkoutUrl, { controlsColor: colors.ink, toolbarColor: colors.paper });
    } catch {
      setError({ productId: product.id, message: t('homeFeed.buySheet.failed') });
    }
  };

  return {
    open: (product: Pick<ProductSummary, 'id' | 'brandId'>, from: BuySource) => void open(product, from),
    pendingId: checkout.isPending ? (checkout.variables?.productId ?? null) : null,
    error,
    clearError: () => setError(null),
  };
}
