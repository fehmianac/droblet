import { apiRequest } from '@/api/client';
import { ApiError } from '@/api/errors';
import { PRODUCT_IDS, type StoreProduct } from '@/fixtures/storeProducts';

import { finishStoreTransaction, startPurchase, storePurchases, type Purchase } from './billing';
import { purchaseMessage } from './PurchaseStatus';
import { purchaseFlow, purchaseRequest } from './purchaseFlow';

jest.mock('@/api/client', () => ({ apiRequest: jest.fn() }));
jest.mock('./billing', () => ({
  startPurchase: jest.fn(async () => undefined),
  finishStoreTransaction: jest.fn(async () => undefined),
  storePurchases: jest.fn(async () => []),
  classifyStoreError: (e: { code?: string } | null) =>
    e?.code === 'user-cancelled' ? 'cancelled' : e?.code === 'deferred-payment' ? 'pending' : e?.code === 'iap-not-available' ? 'unavailable' : 'error',
}));

const api = apiRequest as jest.Mock;
const finish = finishStoreTransaction as jest.Mock;
const start = startPurchase as jest.Mock;

const yearly: StoreProduct = { productId: PRODUCT_IDS.yearly, kind: 'subscription', period: 'year', localizedPrice: '₺1', trialDays: 7, credits: null };
const pack: StoreProduct = { productId: PRODUCT_IDS.credits20, kind: 'consumable', period: null, localizedPrice: '₺1', trialDays: null, credits: 20 };

const premiumWire = {
  tier: 'premium',
  productId: PRODUCT_IDS.yearly,
  platform: 'apple',
  expiresAt: null,
  credits: { monthlyAllowance: 30, allowanceRemaining: 30, packRemaining: 0, totalRemaining: 30, resetsAt: null },
  itemRecognition: { limit: null, used: 0, remaining: null },
};

function storePurchase(productId: string, overrides: Partial<Purchase> = {}): Purchase {
  return {
    id: '2000000001',
    productId,
    purchaseState: 'purchased',
    purchaseToken: 'eyJhbGciOiJFUzI1NiJ9.payload.sig',
    transactionDate: Date.now(),
    isAutoRenewing: true,
    quantity: 1,
    store: 'apple',
    storeId: 'apple',
    platform: 'ios',
    ...overrides,
  } as unknown as Purchase;
}

beforeEach(() => {
  jest.clearAllMocks();
  purchaseFlow.__reset();
});

describe('purchase flow', () => {
  it('sends the StoreKit JWS, finishes the transaction only after the server confirmed it', async () => {
    api.mockResolvedValueOnce(premiumWire);
    await purchaseFlow.buy(yearly, 'acc-token', true);
    expect(start).toHaveBeenCalledWith(yearly, 'acc-token');
    expect(purchaseFlow.getState().phase).toBe('purchasing');

    const purchase = storePurchase(PRODUCT_IDS.yearly);
    await purchaseFlow.handlePurchase(purchase);

    expect(api).toHaveBeenCalledWith('v1/tenant/entitlement/purchase', {
      method: 'POST',
      body: { platform: 'apple', productId: PRODUCT_IDS.yearly, transactionId: '2000000001', signedTransaction: 'eyJhbGciOiJFUzI1NiJ9.payload.sig' },
    });
    expect(finish).toHaveBeenCalledWith(purchase, false);
    expect(api.mock.invocationCallOrder[0]!).toBeLessThan(finish.mock.invocationCallOrder[0]!);
    expect(purchaseFlow.getState()).toMatchObject({ phase: 'success', productId: PRODUCT_IDS.yearly });
    expect(purchaseMessage(purchaseFlow.getState())?.key).toBe('purchase.successMember');
  });

  it('a consumable is finished as consumable and reports its credits', async () => {
    api.mockResolvedValueOnce({ ...premiumWire, tier: 'free' });
    await purchaseFlow.buy(pack, null, true);
    await purchaseFlow.handlePurchase(storePurchase(PRODUCT_IDS.credits20));

    expect(finish).toHaveBeenCalledWith(expect.anything(), true);
    expect(purchaseMessage(purchaseFlow.getState())).toEqual({ key: 'purchase.successPack', count: 20, tone: 'accent' });
  });

  it('never finishes when the server refuses or cannot be reached', async () => {
    for (const [error, kind] of [
      [new ApiError('network', null, null), 'network'],
      [new ApiError('http', 422, { code: 'purchase_invalid' } as never), 'invalid'],
      [new ApiError('http', 501, { code: 'purchase_verification_unavailable' } as never), 'not_configured'],
    ] as const) {
      purchaseFlow.__reset();
      api.mockRejectedValueOnce(error);
      await purchaseFlow.buy(yearly, null, true);
      await purchaseFlow.handlePurchase(storePurchase(PRODUCT_IDS.yearly));
      expect(purchaseFlow.getState()).toMatchObject({ phase: 'error', error: kind });
    }
    expect(finish).not.toHaveBeenCalled();
  });

  it('pending (Ask to Buy / Android pending) is neither sent nor finished', async () => {
    await purchaseFlow.buy(yearly, null, true);
    await purchaseFlow.handlePurchase(storePurchase(PRODUCT_IDS.yearly, { purchaseState: 'pending' }));

    expect(api).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    expect(purchaseFlow.getState().phase).toBe('pending');
  });

  it('a 202 purchase_pending from the server keeps the transaction', async () => {
    api.mockResolvedValueOnce({ code: 'purchase_pending' });
    await purchaseFlow.buy(yearly, null, true);
    await purchaseFlow.handlePurchase(storePurchase(PRODUCT_IDS.yearly));

    expect(finish).not.toHaveBeenCalled();
    expect(purchaseFlow.getState().phase).toBe('pending');
  });

  it('cancel and store errors map to their states', async () => {
    await purchaseFlow.buy(yearly, null, true);
    purchaseFlow.handleStoreError({ code: 'user-cancelled' });
    expect(purchaseFlow.getState().phase).toBe('cancelled');

    await purchaseFlow.buy(yearly, null, true);
    purchaseFlow.handleStoreError({ code: 'deferred-payment' });
    expect(purchaseFlow.getState().phase).toBe('pending');

    await purchaseFlow.buy(yearly, null, true);
    purchaseFlow.handleStoreError({ code: 'iap-not-available' });
    expect(purchaseFlow.getState()).toMatchObject({ phase: 'error', error: 'unavailable' });
  });

  it('prevents a double purchase: a second tap while the sheet is open is ignored', async () => {
    await purchaseFlow.buy(yearly, null, true);
    await purchaseFlow.buy(pack, null, true);

    expect(start).toHaveBeenCalledTimes(1);
    expect(purchaseFlow.getState().productId).toBe(PRODUCT_IDS.yearly);
  });

  it('the same transaction delivered twice at once is verified once', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    api.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const purchase = storePurchase(PRODUCT_IDS.yearly);
    const first = purchaseFlow.handlePurchase(purchase);
    await purchaseFlow.handlePurchase(purchase);
    resolve(premiumWire);
    await first;

    expect(api).toHaveBeenCalledTimes(1);
  });

  it('without store products buying shows the clear "store unavailable" error', async () => {
    await purchaseFlow.buy(yearly, null, false);

    expect(start).not.toHaveBeenCalled();
    expect(purchaseMessage(purchaseFlow.getState())).toEqual({ key: 'purchase.errorUnavailable', tone: 'danger' });
  });

  it('a membership that sits on another Droblet account is moved here: 409 → restore → finished', async () => {
    const purchase = storePurchase(PRODUCT_IDS.yearly);
    (storePurchases as jest.Mock).mockResolvedValueOnce([purchase]);
    api.mockRejectedValueOnce(new ApiError('http', 409, { code: 'purchase_owned_by_another_account' } as never));
    api.mockResolvedValueOnce({ entitlement: premiumWire, restored: 1, ownedByAnotherAccount: 0 });

    await purchaseFlow.buy(yearly, null, true);
    await purchaseFlow.handlePurchase(purchase);

    expect(api.mock.calls.map((c) => c[0])).toEqual(['v1/tenant/entitlement/purchase', 'v1/tenant/entitlement/restore']);
    expect(purchaseFlow.getState()).toMatchObject({ phase: 'restored', restored: { member: true, ownedElsewhere: 0 } });
    expect(purchaseMessage(purchaseFlow.getState())?.key).toBe('purchase.restoredMember');
    expect(finish).toHaveBeenCalledWith(purchase, false);
  });

  it('when the move is refused (moved too recently) the "belongs to another account" message stays and nothing is finished', async () => {
    const purchase = storePurchase(PRODUCT_IDS.yearly);
    (storePurchases as jest.Mock).mockResolvedValueOnce([purchase]);
    api.mockRejectedValueOnce(new ApiError('http', 409, { code: 'purchase_owned_by_another_account' } as never));
    api.mockResolvedValueOnce({ entitlement: { ...premiumWire, tier: 'free' }, restored: 0, ownedByAnotherAccount: 1 });

    await purchaseFlow.buy(yearly, null, true);
    await purchaseFlow.handlePurchase(purchase);

    expect(purchaseMessage(purchaseFlow.getState())?.key).toBe('purchase.restoredElsewhere');
    expect(finish).not.toHaveBeenCalled();
  });

  it('a 409 for a transaction delivered in the background moves nothing', async () => {
    api.mockRejectedValueOnce(new ApiError('http', 409, { code: 'purchase_owned_by_another_account' } as never));
    await purchaseFlow.handlePurchase(storePurchase(PRODUCT_IDS.yearly));
    expect(api).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();
  });

  it('restore sends what the store holds and reports the result', async () => {
    (storePurchases as jest.Mock).mockResolvedValueOnce([storePurchase(PRODUCT_IDS.yearly), storePurchase(PRODUCT_IDS.monthly, { purchaseState: 'pending' })]);
    api.mockResolvedValueOnce({ entitlement: premiumWire, restored: 1, ownedByAnotherAccount: 0 });

    await purchaseFlow.restore();

    expect(api).toHaveBeenCalledWith('v1/tenant/entitlement/restore', {
      method: 'POST',
      body: {
        platform: 'apple',
        purchases: [{ productId: PRODUCT_IDS.yearly, transactionId: '2000000001', signedTransaction: 'eyJhbGciOiJFUzI1NiJ9.payload.sig' }],
      },
    });
    expect(purchaseMessage(purchaseFlow.getState())?.key).toBe('purchase.restoredMember');
  });

  it('Google sends the purchase token as the transaction id', () => {
    expect(purchaseRequest(storePurchase(PRODUCT_IDS.credits20, { purchaseToken: 'play-token' }), 'google')).toEqual({
      platform: 'google',
      productId: PRODUCT_IDS.credits20,
      transactionId: 'play-token',
    });
  });
});
