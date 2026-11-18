/* global jest */
// Native modules without a JS fallback in Jest.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

// expo-contacts has no JS fallback in Jest: permission undetermined, an empty address book.
jest.mock('expo-contacts/legacy', () => ({
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  Fields: { Emails: 'emails' },
  getPermissionsAsync: jest.fn(async () => ({ status: 'undetermined', canAskAgain: true, granted: false })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true, granted: true })),
  getContactsAsync: jest.fn(async () => ({ data: [], hasNextPage: false, hasPreviousPage: false })),
}));
