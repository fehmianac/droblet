import { useTranslation } from 'react-i18next';

import { Text } from '@/components/ui/Text';
import { PACK_CREDITS } from '@/fixtures/storeProducts';

import type { PurchaseErrorKind, PurchaseState } from './purchaseFlow';

type PurchaseKey =
  | 'purchasing'
  | 'verifying'
  | 'restoring'
  | 'pending'
  | 'cancelled'
  | 'successPack'
  | 'successMember'
  | 'restoredMember'
  | 'restoredElsewhere'
  | 'restoredNone'
  | 'errorUnavailable'
  | 'errorNetwork'
  | 'errorInvalid'
  | 'errorOwnedElsewhere'
  | 'errorNotConfigured'
  | 'errorStore';

export type PurchaseMessage = { key: `purchase.${PurchaseKey}`; count?: number; tone: 'muted' | 'danger' | 'accent' } | null;

const ERROR_KEYS: Record<PurchaseErrorKind, `purchase.${PurchaseKey}`> = {
  unavailable: 'purchase.errorUnavailable',
  network: 'purchase.errorNetwork',
  invalid: 'purchase.errorInvalid',
  owned_elsewhere: 'purchase.errorOwnedElsewhere',
  not_configured: 'purchase.errorNotConfigured',
  store: 'purchase.errorStore',
};

/** Purchase state → the one line under the buy button (05 / 05b). Pure. */
export function purchaseMessage(state: PurchaseState): PurchaseMessage {
  switch (state.phase) {
    case 'purchasing':
      return { key: 'purchase.purchasing', tone: 'muted' };
    case 'verifying':
      return { key: 'purchase.verifying', tone: 'muted' };
    case 'restoring':
      return { key: 'purchase.restoring', tone: 'muted' };
    case 'pending':
      return { key: 'purchase.pending', tone: 'muted' };
    case 'cancelled':
      return { key: 'purchase.cancelled', tone: 'muted' };
    case 'success': {
      const credits = state.productId ? PACK_CREDITS[state.productId] : undefined;
      return credits ? { key: 'purchase.successPack', count: credits, tone: 'accent' } : { key: 'purchase.successMember', tone: 'accent' };
    }
    case 'restored':
      if (state.restored?.member) return { key: 'purchase.restoredMember', tone: 'accent' };
      if (state.restored && state.restored.ownedElsewhere > 0) return { key: 'purchase.restoredElsewhere', tone: 'danger' };
      return { key: 'purchase.restoredNone', tone: 'muted' };
    case 'error':
      return { key: ERROR_KEYS[state.error ?? 'store'], tone: 'danger' };
    default:
      return null;
  }
}

/** The status line; announced to screen readers when it changes. `className` adds spacing where it sits (in a row card). */
export function PurchaseStatus({ state, className }: { state: PurchaseState; className?: string }) {
  const { t } = useTranslation();
  const message = purchaseMessage(state);
  if (!message) return null;
  return (
    <Text
      variant="caption"
      tone={message.tone}
      className={`text-center ${className ?? ''}`}
      accessibilityLiveRegion="polite"
      accessibilityRole={message.tone === 'danger' ? 'alert' : 'text'}
      testID="purchase.status"
    >
      {t(message.key, { count: message.count ?? 1 })}
    </Text>
  );
}
