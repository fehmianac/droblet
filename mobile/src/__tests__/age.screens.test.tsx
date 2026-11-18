import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { ageConfirmedOf } from '@/api/auth';
import { onboardingStore } from '@/auth/onboarding';
import { sessionStore } from '@/auth/session';
import { resetAgeFixtures } from '@/features/consent/age';
import i18n from '@/i18n';

type StoredUser = { id: string; name: string; email: string; ageConfirmed?: boolean };
let mockStored: { accessToken: string; refreshToken: string; expiresAt: number; user: StoredUser } | null = null;

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => (mockStored ? JSON.stringify(mockStored) : null)),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  AFTER_FIRST_UNLOCK: 0,
}));
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'cancel' })), maybeCompleteAuthSession: jest.fn() }));

const mockRegister = jest.fn();
jest.mock('@/api/auth', () => ({
  ...jest.requireActual('@/api/auth'),
  useRegister: () => ({ mutate: mockRegister, isPending: false, isSuccess: false, isError: false }),
}));

const WAIT = { timeout: 5000 };

function signedIn(ageConfirmed: boolean | undefined) {
  mockStored = {
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3_600_000,
    user: { id: 'u1', name: 'Damla', email: 'damla@example.com', ...(ageConfirmed === undefined ? {} : { ageConfirmed }) },
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockStored = null;
  resetAgeFixtures(true);
  await AsyncStorage.clear();
  await onboardingStore.markDone('u1');
  await i18n.changeLanguage('en');
});

describe('18+ on e-mail sign-up', () => {
  it('the box is required and unticked; the request carries ageConfirmed: true', async () => {
    await renderRouter('./src/app', { initialUrl: '/start?mode=register' });
    await waitFor(() => expect(screen.getByTestId('age.checkbox')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('age.checkbox')).not.toBeChecked();
    expect(screen.getByText('I am 18 or older')).toBeTruthy();
    expect(screen.getByText('Terms of Use')).toBeTruthy();
    expect(screen.getByText('Privacy Policy')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('auth.name'), 'Damla');
    await fireEvent.changeText(screen.getByTestId('auth.email'), 'damla@example.com');
    await fireEvent.changeText(screen.getByTestId('auth.password'), 'Sm0keTest2026');
    await fireEvent.press(screen.getByTestId('auth.submit'));
    await waitFor(() => expect(screen.getByText('Confirm that you are 18 or older to continue.')).toBeTruthy(), WAIT);
    expect(mockRegister).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('age.checkbox'));
    await fireEvent.press(screen.getByTestId('auth.submit'));
    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1), WAIT);
    expect(mockRegister.mock.calls[0][0]).toEqual({ name: 'Damla', email: 'damla@example.com', password: 'Sm0keTest2026', ageConfirmed: true });
  });

  it('the login tab has no age box', async () => {
    await renderRouter('./src/app', { initialUrl: '/start?mode=login' });
    await waitFor(() => expect(screen.getByText('Welcome back')).toBeTruthy(), WAIT);
    expect(screen.queryByTestId('age.checkbox')).toBeNull();
  });
});

describe('18+ confirmation after Apple / Google', () => {
  it('an unconfirmed account sees the confirmation before anything else, and continues once confirmed', async () => {
    signedIn(false);
    resetAgeFixtures(false);
    await renderRouter('./src/app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('age-confirm')).toBeTruthy(), WAIT);
    expect(screen).toHavePathname('/age-confirm');
    expect(screen.getByText('One more step')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('age.confirm'));
    await waitFor(() => expect(screen.getByText('Confirm that you are 18 or older to continue.')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('age.checkbox'));
    await fireEvent.press(screen.getByTestId('age.confirm'));
    await waitFor(() => expect(screen.queryByTestId('age-confirm')).toBeNull(), WAIT);
    expect(sessionStore.getState()).toMatchObject({ status: 'signedIn', user: { ageConfirmed: true } });
    expect(screen).toHavePathname('/');
  });

  it('other routes redirect to the confirmation too', async () => {
    signedIn(false);
    await renderRouter('./src/app', { initialUrl: '/settings' });
    await waitFor(() => expect(screen.getByTestId('age-confirm')).toBeTruthy(), WAIT);
  });

  it('a session stored before the check asks the profile once; an unconfirmed account is then routed', async () => {
    signedIn(undefined);
    resetAgeFixtures(false);
    await renderRouter('./src/app', { initialUrl: '/settings' });
    await waitFor(() => expect(screen.getByTestId('age-confirm')).toBeTruthy(), WAIT);
  });

  it('a confirmed account goes straight in', async () => {
    signedIn(undefined);
    await renderRouter('./src/app', { initialUrl: '/settings' });
    await waitFor(() => expect(sessionStore.getState()).toMatchObject({ user: { ageConfirmed: true } }), WAIT);
    expect(screen.queryByTestId('age-confirm')).toBeNull();
  });
});

describe('ageConfirmedOf', () => {
  const profile = { tenantId: 't', displayName: null, handle: null, email: null, closetVisibility: 'private' as const, language: 'tr', cityId: null, version: 1, updatedAt: '' };
  it('reads the profile field; unknown when the server does not send it', () => {
    expect(ageConfirmedOf({ ...profile, ageConfirmedAt: '2026-11-19T09:00:00Z' })).toBe(true);
    expect(ageConfirmedOf({ ...profile, ageConfirmedAt: null })).toBe(false);
    expect(ageConfirmedOf(profile)).toBeUndefined();
    expect(ageConfirmedOf(null)).toBeUndefined();
  });
});
