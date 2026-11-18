/* global jest */
// Native modules without a JS fallback in Jest.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

// StoreKit 2 / Play Billing (expo-iap): no store in Jest — the catalogue falls back to the
// representative fixtures; the purchase flow is tested against mocks of src/purchases/billing.
jest.mock('expo-iap', () => ({
  ErrorCode: {
    UserCancelled: 'user-cancelled',
    DeferredPayment: 'deferred-payment',
    Pending: 'pending',
    IapNotAvailable: 'iap-not-available',
    BillingUnavailable: 'billing-unavailable',
    ServiceDisconnected: 'service-disconnected',
    InitConnection: 'init-connection',
    NotPrepared: 'not-prepared',
    SkuNotFound: 'sku-not-found',
    ItemUnavailable: 'item-unavailable',
    AlreadyOwned: 'already-owned',
  },
  initConnection: jest.fn(async () => false),
  fetchProducts: jest.fn(async () => []),
  getAvailablePurchases: jest.fn(async () => []),
  requestPurchase: jest.fn(async () => null),
  finishTransaction: jest.fn(async () => undefined),
  purchaseUpdatedListener: jest.fn(() => ({ remove: jest.fn() })),
  purchaseErrorListener: jest.fn(() => ({ remove: jest.fn() })),
}));

// Push: permission not granted, no token, no taps.
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: false })),
  getDevicePushTokenAsync: jest.fn(async () => ({ type: 'ios', data: '' })),
  setNotificationChannelAsync: jest.fn(async () => null),
  setNotificationHandler: jest.fn(),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponse: jest.fn(() => null),
}));

// expo-contacts has no JS fallback in Jest: permission undetermined, an empty address book.
jest.mock('expo-contacts/legacy', () => ({
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  Fields: { Emails: 'emails' },
  getPermissionsAsync: jest.fn(async () => ({ status: 'undetermined', canAskAgain: true, granted: false })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true, granted: true })),
  getContactsAsync: jest.fn(async () => ({ data: [], hasNextPage: false, hasPreviousPage: false })),
}));
