/* global jest */
// Native modules without a JS fallback in Jest.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
// expo-camera (12 Parça ekle): no camera in Jest — see `jest/expoCameraMock.js` for how a test drives it.
jest.mock('expo-camera', () => require('./expoCameraMock'));
