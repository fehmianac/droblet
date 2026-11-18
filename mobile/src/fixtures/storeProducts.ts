/**
 * Store product shape + the REPRESENTATIVE fallback catalogue (owner decision 2026-11-18).
 *
 * Real prices and the trial length are always read from StoreKit 2 / Play Billing at runtime
 * (`src/purchases/billing.ts` → `useStoreProducts`) and are never hard-coded in screens. The
 * `placeholderStoreProducts` below are shown ONLY when the store returns nothing — an iOS simulator
 * without the StoreKit configuration file, a device without Play services, web, Jest — and then
 * buying is switched off (`purchasesAvailable: false`) with a clear "store unavailable" message.
 */
export type StoreProductKind = 'subscription' | 'consumable';

export type StoreProduct = {
  productId: string;
  kind: StoreProductKind;
  period: 'month' | 'year' | null;
  /** Store-formatted price in the user's currency, e.g. "₺199,99". */
  localizedPrice: string;
  /** Free-trial length from the store's introductory offer; null when none (or not eligible). */
  trialDays: number | null;
  /** Consumable credit amount (AI images). */
  credits: number | null;
  /** Android: offer token of the subscription offer to buy (free-trial offer when eligible, else the base plan). */
  offerToken?: string | null;
};

export const PRODUCT_IDS = {
  monthly: 'com.alatech.droplet.premium.monthly',
  yearly: 'com.alatech.droplet.premium.yearly',
  credits20: 'com.alatech.droplet.credits.20',
} as const;

export const SUBSCRIPTION_IDS: string[] = [PRODUCT_IDS.monthly, PRODUCT_IDS.yearly];
export const CONSUMABLE_IDS: string[] = [PRODUCT_IDS.credits20];

/** Credits each consumable adds (mirrors the server's `Store:CreditPacks`; the server is the authority). */
export const PACK_CREDITS: Record<string, number> = { [PRODUCT_IDS.credits20]: 20 };

/** REPRESENTATIVE values — fallback only, see the file comment. */
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
