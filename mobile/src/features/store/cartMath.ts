import type { Cart, CartGroup, ProductSize, ProductSummary, StoreLookRef } from '@/api/contracts/store';
import { sumMoney, type Money } from '@/lib/format';

function totals(groups: CartGroup[]): Cart {
  const priced = groups
    .map((g) => ({ ...g, subtotal: sumMoney(g.lines.map((l) => l.price)) }))
    .filter((g) => g.lines.length > 0);
  return {
    groups: priced,
    total: sumMoney(priced.map((g) => g.subtotal)),
    lineCount: priced.reduce((sum, g) => sum + g.lines.length, 0),
  };
}

export type NewCartLine = { clientMutationId: string; product: ProductSummary; size: ProductSize; look?: StoreLookRef };

/**
 * Optimistic cart after "Sepete ekle": lines join their brand's group (new brands go last).
 * The optimistic line id is the `clientMutationId`; the server's cart replaces it on the next read.
 */
export function addLinesToCart(cart: Cart | undefined, lines: NewCartLine[]): Cart {
  const groups: CartGroup[] = (cart?.groups ?? []).map((g) => ({ ...g, lines: [...g.lines] }));
  for (const { clientMutationId, product, size } of lines) {
    if (groups.some((g) => g.lines.some((l) => l.lineId === clientMutationId))) continue;
    let group = groups.find((g) => g.brandId === product.brandId);
    if (!group) {
      group = { brandId: product.brandId, brandName: product.brandName, brandLogoUrl: product.brandLogoUrl ?? null, subtotal: null, lines: [] };
      groups.push(group);
    }
    group.lines.push({
      lineId: clientMutationId,
      productId: product.id,
      name: product.name,
      size,
      price: product.price,
      imageUrl: product.imageUrl,
    });
  }
  return totals(groups);
}

/** Optimistic cart after removing a line; an emptied brand group disappears. */
export function removeLineFromCart(cart: Cart, lineId: string): Cart {
  return totals(cart.groups.map((g) => ({ ...g, lines: g.lines.filter((l) => l.lineId !== lineId) })));
}

/** Whole-percent price drop ("Fiyat %20 düştü"); null when there is no drop to show. */
export function priceDropPercent(price: Money | null, previousPrice: Money | null): number | null {
  if (price === null || previousPrice === null || price.currency !== previousPrice.currency) return null;
  const now = price.amountMinor;
  const before = previousPrice.amountMinor;
  if (before <= 0 || now >= before) return null;
  const percent = Math.round(((before - now) / before) * 100);
  return percent > 0 ? percent : null;
}

/**
 * The size to preselect: the body-profile size when the product is sold in it, the only size of a
 * one-size product, otherwise nothing (the user picks).
 */
export function preferredSize(sizes: ProductSize[], profileSize: ProductSize | null | undefined): ProductSize | null {
  if (profileSize && sizes.includes(profileSize)) return profileSize;
  if (sizes.length === 1) return sizes[0] ?? null;
  return null;
}
