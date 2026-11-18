import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { resetFixtureDb } from '@/fixtures/db';
import i18n from '@/i18n';

const mockSession = {
  accessToken: 'a',
  refreshToken: 'r',
  expiresAt: Date.now() + 3_600_000,
  user: { id: 'u1', name: 'Damla', email: 'damla@example.com' },
};

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => JSON.stringify(mockSession)),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  AFTER_FIRST_UNLOCK: 0,
}));
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

// The Keşfet cover throws while rendering — as it did on data of the wrong shape.
let mockBreakDiscover = true;
jest.mock('@/features/store/CreatorCardView', () => ({
  CreatorCardView: () => {
    if (mockBreakDiscover) throw new TypeError("Cannot read property 'split' of undefined");
    return null;
  },
}));

const WAIT = { timeout: 8000 };
jest.setTimeout(30_000);

beforeEach(async () => {
  resetFixtureDb();
  mockBreakDiscover = true;
  await AsyncStorage.clear();
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
  await i18n.changeLanguage('en');
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('per-tab error boundary', () => {
  it('a render error in Keşfet shows the error state; the tab bar and the other tabs keep working; "Try again" recovers', async () => {
    await renderRouter('./src/app', { initialUrl: '/discover' });
    await waitFor(() => expect(screen.getByTestId('screen-error-boundary')).toBeTruthy(), WAIT);
    expect(screen.getByText("This screen couldn't open")).toBeTruthy();
    expect(screen.getByTestId('tab.today')).toBeTruthy();

    mockBreakDiscover = false;
    await fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => expect(screen.queryByTestId('screen-error-boundary')).toBeNull(), WAIT);

    await fireEvent.press(screen.getByTestId('tab.today'));
    await waitFor(() => expect(screen.getByLabelText(/^Notifications/)).toBeTruthy(), WAIT);
  });
});
