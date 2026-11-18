import { CONSUMABLE_IDS, PACK_CREDITS, PRODUCT_IDS, type StoreProduct } from '@/fixtures/storeProducts';

/**
 * Store product (expo-iap `Product` / `ProductSubscription`, iOS or Android) → the app's
 * `StoreProduct`. Pure; the structural types below are the fields we read, so tests can feed plain
 * objects. Price and trial always come from the store — nothing here invents a number.
 */
type PeriodUnit = 'day' | 'week' | 'month' | 'year' | 'unknown' | 'empty';

type OfferLike = {
  type?: string | null;
  paymentMode?: string | null;
  period?: { unit: PeriodUnit; value: number } | null;
  periodCount?: number | null;
  offerTokenAndroid?: string | null;
  basePlanIdAndroid?: string | null;
  offerTagsAndroid?: string[] | null;
  pricingPhasesAndroid?: {
    pricingPhaseList: { billingPeriod: string; priceAmountMicros: string; formattedPrice: string; recurrenceMode: number; billingCycleCount: number }[];
  } | null;
};

export type StoreProductLike = {
  id: string;
  platform: 'ios' | 'android';
  type: 'in-app' | 'subs';
  displayPrice: string;
  subscriptionOffers?: OfferLike[] | null;
  introductoryPricePaymentModeIOS?: string | null;
  introductoryPriceNumberOfPeriodsIOS?: string | null;
  introductoryPriceSubscriptionPeriodIOS?: PeriodUnit | null;
  subscriptionPeriodUnitIOS?: PeriodUnit | null;
};

const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };

/** ISO-8601 period (Play `billingPeriod`: P3D, P1W, P1M, P1Y) → days; null when unreadable. */
export function isoPeriodDays(period: string | null | undefined): number | null {
  const match = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/.exec(period ?? '');
  if (!match) return null;
  const [, y, m, w, d] = match.map((v) => (v ? Number(v) : 0));
  const days = (y ?? 0) * 365 + (m ?? 0) * 30 + (w ?? 0) * 7 + (d ?? 0);
  return days > 0 ? days : null;
}

function offerTrialDays(offer: OfferLike): number | null {
  // Android: a free phase (price 0) before the recurring one.
  const phases = offer.pricingPhasesAndroid?.pricingPhaseList ?? [];
  const free = phases.find((p) => p.priceAmountMicros === '0');
  if (free) return isoPeriodDays(free.billingPeriod);
  if (offer.paymentMode === 'free-trial' && offer.period && UNIT_DAYS[offer.period.unit]) {
    return UNIT_DAYS[offer.period.unit]! * Math.max(1, offer.period.value) * Math.max(1, offer.periodCount ?? 1);
  }
  return null;
}

/** Free-trial length in days, or null (no trial, or the user is not eligible — the store only lists eligible offers). */
export function trialDaysOf(product: StoreProductLike): number | null {
  for (const offer of product.subscriptionOffers ?? []) {
    if (offer.type && offer.type !== 'introductory' && !offer.pricingPhasesAndroid) continue;
    const days = offerTrialDays(offer);
    if (days) return days;
  }
  if (product.introductoryPricePaymentModeIOS === 'free-trial' && product.introductoryPriceSubscriptionPeriodIOS) {
    const unit = UNIT_DAYS[product.introductoryPriceSubscriptionPeriodIOS];
    if (unit) return unit * Math.max(1, Number(product.introductoryPriceNumberOfPeriodsIOS ?? '1') || 1);
  }
  return null;
}

/** Android: the offer to buy — the free-trial offer when the user is eligible, otherwise the base plan. */
function androidOffer(product: StoreProductLike): OfferLike | null {
  const offers = (product.subscriptionOffers ?? []).filter((o) => o.offerTokenAndroid);
  return offers.find((o) => offerTrialDays(o) !== null) ?? offers.find((o) => (o.pricingPhasesAndroid?.pricingPhaseList.length ?? 0) === 1) ?? offers[0] ?? null;
}

/** The recurring price (Android: the last, infinitely recurring phase of the chosen offer). */
function recurringPrice(product: StoreProductLike, offer: OfferLike | null): string {
  const phases = offer?.pricingPhasesAndroid?.pricingPhaseList ?? [];
  const recurring = phases.find((p) => p.recurrenceMode === 1) ?? phases[phases.length - 1];
  return recurring?.formattedPrice ?? product.displayPrice;
}

export function toStoreProduct(product: StoreProductLike): StoreProduct | null {
  if (CONSUMABLE_IDS.includes(product.id)) {
    return {
      productId: product.id,
      kind: 'consumable',
      period: null,
      localizedPrice: product.displayPrice,
      trialDays: null,
      credits: PACK_CREDITS[product.id] ?? null,
    };
  }
  if (product.id !== PRODUCT_IDS.monthly && product.id !== PRODUCT_IDS.yearly) return null;
  const offer = product.platform === 'android' ? androidOffer(product) : null;
  return {
    productId: product.id,
    kind: 'subscription',
    period: product.id === PRODUCT_IDS.yearly ? 'year' : 'month',
    localizedPrice: product.platform === 'android' ? recurringPrice(product, offer) : product.displayPrice,
    trialDays: offer ? offerTrialDays(offer) : trialDaysOf(product),
    credits: null,
    offerToken: offer?.offerTokenAndroid ?? null,
  };
}

/** Our products in a stable order (monthly, yearly, pack), unknown ids dropped. */
export function toStoreProducts(products: StoreProductLike[]): StoreProduct[] {
  const order = [PRODUCT_IDS.monthly, PRODUCT_IDS.yearly, PRODUCT_IDS.credits20] as string[];
  return products
    .map(toStoreProduct)
    .filter((p): p is StoreProduct => p !== null)
    .sort((a, b) => order.indexOf(a.productId) - order.indexOf(b.productId));
}
