import { planOfProduct, toEntitlement, type EntitlementWire } from './core';

const wire = (over: Partial<EntitlementWire> = {}): EntitlementWire => ({
  tier: 'premium',
  productId: 'com.alatech.droplet.premium.yearly',
  platform: 'apple',
  expiresAt: '2027-01-01T00:00:00Z',
  credits: { monthlyAllowance: 30, allowanceRemaining: 20, packRemaining: 5, totalRemaining: 25, resetsAt: '2026-12-01T00:00:00Z' },
  itemRecognition: { limit: null, used: 3, remaining: null },
  ...over,
});

describe('entitlement mapper', () => {
  it('reads the billing period from the store product id', () => {
    expect(planOfProduct('com.alatech.droplet.premium.yearly')).toBe('yearly');
    expect(planOfProduct('com.alatech.droplet.premium.monthly')).toBe('monthly');
    expect(planOfProduct('com.alatech.droplet.credits.20')).toBeUndefined();
    expect(planOfProduct(null)).toBeUndefined();
  });

  it('maps a membership with its plan and a free account without one', () => {
    expect(toEntitlement(wire())).toMatchObject({ tier: 'member', plan: 'yearly', credits: { remaining: 25 } });
    const free = toEntitlement(wire({ tier: 'free', productId: null }));
    expect(free.tier).toBe('free');
    expect(free.plan).toBeUndefined();
  });
});
