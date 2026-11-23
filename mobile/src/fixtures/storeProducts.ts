/**
 * Store product shape + the fallback catalogue.
 *
 * Prices and the trial length come from the store only (owner decision 2026-11-23: "fiyatlar store'dan gelsin"): they
 * are read from StoreKit 2 / Play Billing at runtime (`src/purchases/billing.ts` → `useStoreProducts`) and nothing in
 * the app carries a price of its own. The `placeholderStoreProducts` below are shown ONLY when the store returns
 * nothing — an iOS simulator without the StoreKit configuration file, a device without Play services, web, Jest, or
 * products the store has not approved yet: the plans and the pack are listed WITHOUT a price and without a trial, and
 * buying is switched off (`purchasesAvailable: false`) with a clear "store unavailable" message.
 */
export type StoreProductKind = 'subscription' | 'consumable';

export type StoreProduct = {
  productId: string;
  kind: StoreProductKind;
  period: 'month' | 'year' | null;
  /** Store-formatted price in the user's currency, e.g. "₺199,99"; empty when the store gave none (the fallback). */
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

/** Fallback only, see the file comment: no price, no trial. */
export const placeholderStoreProducts: StoreProduct[] = [
  {
    productId: PRODUCT_IDS.monthly,
    kind: 'subscription',
    period: 'month',
    localizedPrice: '',
    trialDays: null,
    credits: null,
  },
  {
    productId: PRODUCT_IDS.yearly,
    kind: 'subscription',
    period: 'year',
    localizedPrice: '',
    trialDays: null,
    credits: null,
  },
  {
    productId: PRODUCT_IDS.credits20,
    kind: 'consumable',
    period: null,
    localizedPrice: '',
    trialDays: null,
    credits: 20,
  },
];
