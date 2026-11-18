/**
 * PLACEHOLDER store products — representative values only (owner decision 2026-11-18).
 * Real prices and trial length are always read from StoreKit 2 / Play Billing at runtime and are
 * never hard-coded in screens. Replace this stub when the native billing bridge lands (E10).
 */
export type StoreProductKind = 'subscription' | 'consumable';

export type StoreProduct = {
  productId: string;
  kind: StoreProductKind;
  period: 'month' | 'year' | null;
  /** Store-formatted price in the user's currency, e.g. "₺199,99". */
  localizedPrice: string;
  /** Free-trial length from the store's introductory offer; null when none. */
  trialDays: number | null;
  /** Consumable credit amount (AI images). */
  credits: number | null;
};

export const PRODUCT_IDS = {
  monthly: 'com.alatech.droplet.premium.monthly',
  yearly: 'com.alatech.droplet.premium.yearly',
  credits20: 'com.alatech.droplet.credits.20',
} as const;

export const placeholderStoreProducts: StoreProduct[] = [
  {
    productId: PRODUCT_IDS.monthly,
    kind: 'subscription',
    period: 'month',
    localizedPrice: '₺199,99',
    trialDays: 7,
    credits: null,
  },
  {
    productId: PRODUCT_IDS.yearly,
    kind: 'subscription',
    period: 'year',
    localizedPrice: '₺1.499,99',
    trialDays: 7,
    credits: null,
  },
  {
    productId: PRODUCT_IDS.credits20,
    kind: 'consumable',
    period: null,
    localizedPrice: '₺79,99',
    trialDays: null,
    credits: 20,
  },
];
