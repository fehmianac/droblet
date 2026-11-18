import {
  ErrorCode,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  type Purchase,
} from 'expo-iap';
import { Platform } from 'react-native';

import { CONSUMABLE_IDS, SUBSCRIPTION_IDS, type StoreProduct } from '@/fixtures/storeProducts';

import { toStoreProducts, type StoreProductLike } from './products';

/**
 * The only file that talks to StoreKit 2 / Google Play Billing — through `expo-iap`, an open-source
 * Expo module that wraps both stores natively (no hosted purchase service, README §9.2). Everything
 * else (purchase flow, screens) goes through these functions, so tests mock this module.
 */
export type { Purchase };

/** What the purchase error listener delivers (expo-iap's mapped error). */
export type StoreError = { code?: string | null; message?: string };

let connection: Promise<boolean> | null = null;

/** Opens the store connection once per app run. False on web / when the store is unavailable. */
export function connectStore(): Promise<boolean> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return Promise.resolve(false);
  connection ??= initConnection()
    .then((ok) => ok !== false)
    .catch(() => {
      connection = null; // retry on the next call (Play services may come back)
      return false;
    });
  return connection;
}

/** Our three products as the store sells them to this user (localized price, eligible trial). Empty when the store has none. */
export async function fetchStoreProducts(): Promise<StoreProduct[]> {
  if (!(await connectStore())) return [];
  const [subs, packs] = await Promise.all([
    fetchProducts({ skus: SUBSCRIPTION_IDS, type: 'subs' }).catch(() => null),
    fetchProducts({ skus: CONSUMABLE_IDS, type: 'in-app' }).catch(() => null),
  ]);
  return toStoreProducts([...((subs ?? []) as StoreProductLike[]), ...((packs ?? []) as StoreProductLike[])]);
}

/**
 * Starts the store's purchase sheet. The result arrives through `onPurchaseUpdated` / `onPurchaseError`.
 * accountToken = the server's `storeAccountToken` (StoreKit appAccountToken / Play obfuscatedAccountId),
 * so the server can tie the purchase (and its notifications) to this account.
 */
export async function startPurchase(product: StoreProduct, accountToken: string | null): Promise<void> {
  if (product.kind === 'subscription') {
    await requestPurchase({
      type: 'subs',
      request: {
        apple: { sku: product.productId, appAccountToken: accountToken },
        google: {
          skus: [product.productId],
          obfuscatedAccountId: accountToken,
          subscriptionOffers: product.offerToken ? [{ sku: product.productId, offerToken: product.offerToken }] : null,
        },
      },
    });
    return;
  }
  await requestPurchase({
    type: 'in-app',
    request: {
      apple: { sku: product.productId, appAccountToken: accountToken },
      google: { skus: [product.productId], obfuscatedAccountId: accountToken },
    },
  });
}

/** Completes a transaction — called only after the server confirmed it (Android: within 3 days or Google refunds). */
export async function finishStoreTransaction(purchase: Purchase, consumable: boolean): Promise<void> {
  await finishTransaction({ purchase, isConsumable: consumable });
}

/** What the store still holds for this user (active subscriptions, unfinished transactions). */
export async function storePurchases(): Promise<Purchase[]> {
  if (!(await connectStore())) return [];
  return getAvailablePurchases({ onlyIncludeActiveItemsIOS: true }).catch(() => []);
}

export function onPurchaseUpdated(listener: (purchase: Purchase) => void): () => void {
  const subscription = purchaseUpdatedListener(listener);
  return () => subscription.remove();
}

export function onPurchaseError(listener: (error: StoreError) => void): () => void {
  const subscription = purchaseErrorListener((error) => listener(error));
  return () => subscription.remove();
}

/** expo-iap error code → what the flow shows. */
export function classifyStoreError(error: { code?: string | null } | null | undefined): 'cancelled' | 'pending' | 'unavailable' | 'already_owned' | 'error' {
  switch (error?.code) {
    case ErrorCode.UserCancelled:
      return 'cancelled';
    case ErrorCode.DeferredPayment:
    case ErrorCode.Pending:
      return 'pending';
    case ErrorCode.IapNotAvailable:
    case ErrorCode.BillingUnavailable:
    case ErrorCode.ServiceDisconnected:
    case ErrorCode.InitConnection:
    case ErrorCode.NotPrepared:
    case ErrorCode.SkuNotFound:
    case ErrorCode.ItemUnavailable:
      return 'unavailable';
    case ErrorCode.AlreadyOwned:
      return 'already_owned';
    default:
      return 'error';
  }
}
