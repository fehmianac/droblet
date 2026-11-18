import { useEffect } from 'react';

import { connectStore, onPurchaseError, onPurchaseUpdated } from './billing';
import { purchaseFlow } from './purchaseFlow';

/**
 * Signed-in only (AppHosts): listens to StoreKit / Play Billing for the whole session, so a purchase
 * that completes while the paywall is closed — Ask to Buy approved later, an unfinished transaction
 * delivered again at launch, an Android purchase the app never acknowledged — is still verified by the
 * server and finished.
 */
export function PurchaseHost() {
  useEffect(() => {
    let active = true;
    const offUpdated = onPurchaseUpdated((purchase) => void purchaseFlow.handlePurchase(purchase));
    const offError = onPurchaseError((error) => purchaseFlow.handleStoreError(error));
    void connectStore().then((ok) => {
      if (ok && active) void purchaseFlow.reconcile().catch(() => undefined);
    });
    return () => {
      active = false;
      offUpdated();
      offError();
    };
  }, []);
  return null;
}
