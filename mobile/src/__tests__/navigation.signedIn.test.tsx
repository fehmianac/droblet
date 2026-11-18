import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

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

describe('navigation (signed in, onboarded)', () => {
  it('lands on 06 Bugün with the tab bar and fixture data', async () => {
    await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
    await renderRouter('./src/app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByText("I'm wearing this")).toBeTruthy(), { timeout: 3000 });
    // Canvas 06: one line, "BUGÜNÜN KOMBİNİ · OFİS".
    expect(screen.getByText("TODAY'S OUTFIT · OFFICE")).toBeTruthy();
    expect(screen.getByLabelText('Stylist')).toBeTruthy();
    expect(screen.getByText('Lacivert Blazer')).toBeTruthy();
  });
});
