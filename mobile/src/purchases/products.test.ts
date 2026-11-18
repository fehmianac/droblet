import { storeCatalog } from '@/entitlement/useStoreProducts';
import { PRODUCT_IDS, placeholderStoreProducts } from '@/fixtures/storeProducts';

import { isoPeriodDays, toStoreProduct, toStoreProducts, trialDaysOf, type StoreProductLike } from './products';

const iosMonthly: StoreProductLike = {
  id: PRODUCT_IDS.monthly,
  platform: 'ios',
  type: 'subs',
  displayPrice: '₺219,99',
  introductoryPricePaymentModeIOS: 'free-trial',
  introductoryPriceNumberOfPeriodsIOS: '1',
  introductoryPriceSubscriptionPeriodIOS: 'week',
  subscriptionOffers: [{ type: 'introductory', paymentMode: 'free-trial', period: { unit: 'week', value: 1 }, periodCount: 1 }],
};

const androidYearly: StoreProductLike = {
  id: PRODUCT_IDS.yearly,
  platform: 'android',
  type: 'subs',
  displayPrice: '₺1.799,99',
  subscriptionOffers: [
    {
      offerTokenAndroid: 'base-token',
      basePlanIdAndroid: 'yearly',
      pricingPhasesAndroid: {
        pricingPhaseList: [{ billingPeriod: 'P1Y', priceAmountMicros: '1799990000', formattedPrice: '₺1.799,99', recurrenceMode: 1, billingCycleCount: 0 }],
      },
    },
    {
      offerTokenAndroid: 'trial-token',
      basePlanIdAndroid: 'yearly',
      pricingPhasesAndroid: {
        pricingPhaseList: [
          { billingPeriod: 'P1W', priceAmountMicros: '0', formattedPrice: 'Free', recurrenceMode: 2, billingCycleCount: 1 },
          { billingPeriod: 'P1Y', priceAmountMicros: '1799990000', formattedPrice: '₺1.799,99', recurrenceMode: 1, billingCycleCount: 0 },
        ],
      },
    },
  ],
};

describe('store products → app products', () => {
  it('reads ISO-8601 periods', () => {
    expect(isoPeriodDays('P1W')).toBe(7);
    expect(isoPeriodDays('P3D')).toBe(3);
    expect(isoPeriodDays('P1M')).toBe(30);
    expect(isoPeriodDays('nonsense')).toBeNull();
  });

  it('takes the iOS price and the free-trial length from the introductory offer', () => {
    expect(toStoreProduct(iosMonthly)).toEqual({
      productId: PRODUCT_IDS.monthly,
      kind: 'subscription',
      period: 'month',
      localizedPrice: '₺219,99',
      trialDays: 7,
      credits: null,
      offerToken: null,
    });
  });

  it('no trial when the store lists no free offer (not eligible)', () => {
    expect(trialDaysOf({ ...iosMonthly, subscriptionOffers: [], introductoryPricePaymentModeIOS: 'empty' })).toBeNull();
  });

  it('Android: buys the eligible free-trial offer and shows the recurring price', () => {
    const product = toStoreProduct(androidYearly);
    expect(product?.offerToken).toBe('trial-token');
    expect(product?.trialDays).toBe(7);
    expect(product?.localizedPrice).toBe('₺1.799,99');
    expect(product?.period).toBe('year');
  });

  it('Android without a trial offer falls back to the base plan', () => {
    const product = toStoreProduct({ ...androidYearly, subscriptionOffers: androidYearly.subscriptionOffers!.slice(0, 1) });
    expect(product?.offerToken).toBe('base-token');
    expect(product?.trialDays).toBeNull();
  });

  it('maps the consumable pack to its credits and drops unknown products, in a stable order', () => {
    const products = toStoreProducts([
      { id: PRODUCT_IDS.credits20, platform: 'ios', type: 'in-app', displayPrice: '₺89,99' },
      { id: 'com.other', platform: 'ios', type: 'in-app', displayPrice: '1' },
      iosMonthly,
    ]);
    expect(products.map((p) => p.productId)).toEqual([PRODUCT_IDS.monthly, PRODUCT_IDS.credits20]);
    expect(products[1]).toMatchObject({ kind: 'consumable', credits: 20, localizedPrice: '₺89,99' });
  });

  it('falls back to the representative fixtures ONLY when the store returned nothing, with buying off', () => {
    expect(storeCatalog([])).toEqual({ purchasesAvailable: false, source: 'fallback', products: placeholderStoreProducts });
    const real = toStoreProducts([iosMonthly]);
    expect(storeCatalog(real)).toEqual({ purchasesAvailable: true, source: 'store', products: real });
  });
});
