import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { track } from '@/analytics/track';
import { apiRequest } from '@/api/client';
import { ApiError } from '@/api/errors';
import {
  toEntitlement,
  type EntitlementWire,
  type PurchasePendingWire,
  type PurchaseRequestWire,
  type RestoreRequestWire,
  type RestoreResponseWire,
} from '@/api/wire/core';
import { CONSUMABLE_IDS, type StoreProduct } from '@/fixtures/storeProducts';
import { getActiveQueryClient } from '@/sync/activeClient';
import { queryKeys } from '@/sync/queryKeys';

import {
  classifyStoreError,
  finishStoreTransaction,
  startPurchase,
  storePurchases,
  type Purchase,
  type StoreError,
} from './billing';

/**
 * Purchase state machine (05 paywall, 05b credit pack):
 *
 *   idle → purchasing (store sheet) → verifying (server) → success
 *                     ↘ cancelled   ↘ pending (Ask to Buy / Android pending)   ↘ error(kind)
 *
 * Rules: one purchase at a time (a second tap while busy is ignored); the store transaction is
 * finished ONLY after the server confirmed it (200) — on any error it stays with the store and is
 * delivered again (next launch / restore), so nothing paid is ever lost; credits and tier always come
 * back from the server, never from the store result.
 */
export type PurchasePhase = 'idle' | 'purchasing' | 'verifying' | 'success' | 'pending' | 'cancelled' | 'error' | 'restoring' | 'restored';

export type PurchaseErrorKind =
  /** Store not reachable / not configured on this device (simulator without StoreKit config, no Play services). */
  | 'unavailable'
  | 'network'
  /** The server did not accept the store's confirmation. */
  | 'invalid'
  /** This Apple ID / Google account's purchase is linked to another Droblet account. */
  | 'owned_elsewhere'
  /** Server-side store verification not configured yet (501). */
  | 'not_configured'
  | 'store';

export type PurchaseState = {
  phase: PurchasePhase;
  productId: string | null;
  error: PurchaseErrorKind | null;
  /** After restore: how many purchases were restored; whether the account is a member now. */
  restored?: { count: number; member: boolean; ownedElsewhere: number };
};

const IDLE: PurchaseState = { phase: 'idle', productId: null, error: null };

let state: PurchaseState = IDLE;
const listeners = new Set<() => void>();
/** Store transactions being verified right now (a listener + a reconcile may deliver the same one). */
const inFlight = new Set<string>();

function emit(next: PurchaseState) {
  state = next;
  listeners.forEach((l) => l());
}

const platform = (): 'apple' | 'google' => (Platform.OS === 'android' ? 'google' : 'apple');

const busy = () => state.phase === 'purchasing' || state.phase === 'verifying' || state.phase === 'restoring';

function transactionKey(purchase: Purchase): string {
  return purchase.purchaseToken ?? purchase.id;
}

/** Store purchase → request body. Apple sends the StoreKit 2 JWS; Google the purchase token. */
export function purchaseRequest(purchase: Purchase, os: 'apple' | 'google' = platform()): PurchaseRequestWire {
  if (os === 'apple') {
    const body: PurchaseRequestWire = { platform: 'apple', productId: purchase.productId, transactionId: purchase.id };
    if (purchase.purchaseToken) body.signedTransaction = purchase.purchaseToken;
    return body;
  }
  return { platform: 'google', productId: purchase.productId, transactionId: purchase.purchaseToken ?? purchase.id };
}

function applyEntitlement(wire: EntitlementWire) {
  const client = getActiveQueryClient();
  client?.setQueryData(queryKeys.entitlement, toEntitlement(wire));
  void client?.invalidateQueries({ queryKey: queryKeys.entitlement });
}

function errorKindOf(error: unknown): PurchaseErrorKind {
  if (error instanceof ApiError) {
    if (error.kind === 'network') return 'network';
    if (error.status === 409) return 'owned_elsewhere';
    if (error.status === 501) return 'not_configured';
    if (error.status === 422 || error.status === 400) return 'invalid';
  }
  return 'store';
}

/** Analytics category of a store product. */
function productKind(productId: string): 'credit_pack' | 'subscription' {
  return CONSUMABLE_IDS.includes(productId) ? 'credit_pack' : 'subscription';
}

export const purchaseFlow = {
  getState: (): PurchaseState => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  reset() {
    if (!busy()) emit(IDLE);
  },

  /** Opens the store sheet for a product. Ignored while another purchase / restore is running. */
  async buy(product: StoreProduct, accountToken: string | null, purchasesAvailable: boolean): Promise<void> {
    if (busy()) return;
    if (!purchasesAvailable) {
      emit({ phase: 'error', productId: product.productId, error: 'unavailable' });
      return;
    }
    emit({ phase: 'purchasing', productId: product.productId, error: null });
    track('begin_checkout', { productId: product.productId, kind: productKind(product.productId) });
    try {
      await startPurchase(product, accountToken);
    } catch (e) {
      this.handleStoreError(e as StoreError);
    }
  },

  /**
   * A transaction from the store (purchase listener, or an unfinished one delivered again at launch).
   * `foreground` = it belongs to the purchase on screen; background ones update nothing on screen
   * unless they succeed.
   */
  async handlePurchase(purchase: Purchase): Promise<void> {
    const foreground = state.productId === purchase.productId && (state.phase === 'purchasing' || state.phase === 'verifying');
    if (purchase.purchaseState === 'pending') {
      if (foreground) emit({ phase: 'pending', productId: purchase.productId, error: null });
      return; // granted later (store notification / next delivery); never finish a pending transaction
    }
    const key = transactionKey(purchase);
    if (inFlight.has(key)) return;
    inFlight.add(key);
    if (foreground) emit({ phase: 'verifying', productId: purchase.productId, error: null });
    try {
      const result = await apiRequest<EntitlementWire | PurchasePendingWire>('v1/tenant/entitlement/purchase', {
        method: 'POST',
        body: purchaseRequest(purchase),
      });
      if ('code' in result) {
        if (foreground) emit({ phase: 'pending', productId: purchase.productId, error: null });
        return;
      }
      applyEntitlement(result);
      // Server confirmed: only now the transaction is completed with the store.
      try {
        await finishStoreTransaction(purchase, CONSUMABLE_IDS.includes(purchase.productId));
      } catch {
        // Android: the server already acknowledged / consumed it; iOS: finished on the next delivery.
      }
      emit({ phase: 'success', productId: purchase.productId, error: null });
      track('purchase', { productId: purchase.productId, kind: productKind(purchase.productId) });
    } catch (e) {
      if (foreground) emit({ phase: 'error', productId: purchase.productId, error: errorKindOf(e) });
    } finally {
      inFlight.delete(key);
    }
  },

  handleStoreError(error: StoreError | null | undefined): void {
    if (!busy() || state.phase === 'restoring') return;
    const kind = classifyStoreError(error);
    if (kind === 'cancelled') emit({ phase: 'cancelled', productId: state.productId, error: null });
    else if (kind === 'pending') emit({ phase: 'pending', productId: state.productId, error: null });
    else if (kind === 'already_owned') void this.restore();
    else emit({ phase: 'error', productId: state.productId, error: kind === 'unavailable' ? 'unavailable' : 'store' });
  },

  /** "Satın alımları geri yükle": sends what the store holds; the server re-reads the store and answers with the tier. */
  async restore(): Promise<void> {
    // Also reachable from an "already owned" store error while the sheet was open (phase purchasing).
    if (state.phase === 'verifying' || state.phase === 'restoring') return;
    emit({ phase: 'restoring', productId: null, error: null });
    try {
      const owned = await storePurchases();
      const body: RestoreRequestWire = {
        platform: platform(),
        purchases: owned
          .filter((p) => p.purchaseState !== 'pending')
          .slice(0, 50)
          .map((p) => {
            const request = purchaseRequest(p);
            return { productId: request.productId, transactionId: request.transactionId, signedTransaction: request.signedTransaction };
          }),
      };
      const result = await apiRequest<RestoreResponseWire>('v1/tenant/entitlement/restore', { method: 'POST', body });
      applyEntitlement(result.entitlement);
      emit({
        phase: 'restored',
        productId: null,
        error: null,
        restored: { count: result.restored, member: result.entitlement.tier === 'premium', ownedElsewhere: result.ownedByAnotherAccount },
      });
    } catch (e) {
      emit({ phase: 'error', productId: null, error: errorKindOf(e) });
    }
  },

  /** Android: purchases the store still holds unacknowledged (app closed mid-flow) are verified at start. */
  async reconcile(): Promise<void> {
    if (Platform.OS !== 'android') return;
    const owned = await storePurchases();
    for (const purchase of owned) {
      if (purchase.purchaseState === 'purchased' && 'isAcknowledgedAndroid' in purchase && purchase.isAcknowledgedAndroid === false) {
        await this.handlePurchase(purchase);
      }
    }
  },

  /** Tests only. */
  __reset() {
    inFlight.clear();
    emit(IDLE);
  },
};

export function usePurchaseState(): PurchaseState {
  return useSyncExternalStore(purchaseFlow.subscribe, purchaseFlow.getState, purchaseFlow.getState);
}
