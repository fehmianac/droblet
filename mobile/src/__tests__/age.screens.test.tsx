import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { ageConfirmedOf } from '@/api/auth';
import { ApiError } from '@/api/errors';
import { onboardingStore } from '@/auth/onboarding';
import { sessionStore } from '@/auth/session';
import { resetAgeFixtures } from '@/features/consent/age';
import { teenStore } from '@/features/teen/store';
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

// Teen mode reads the age state from the API in every build (no fixture): each test answers what it needs.
const mockApi = jest.fn();
jest.mock('@/api/client', () => ({ ...jest.requireActual('@/api/client'), apiRequest: (...args: unknown[]) => mockApi(...args) }));

const WAIT = { timeout: 5000 };
const YEAR = new Date().getFullYear();
const PROFILE = {
  tenantId: 't',
  displayName: 'Damla',
  handle: null,
  email: 'damla@example.com',
  closetVisibility: 'private',
  language: 'en',
  cityId: null,
  version: 1,
  updatedAt: '',
};

function signedIn(ageConfirmed: boolean | undefined) {
  mockStored = {
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3_600_000,
    user: { id: 'u1', name: 'Damla', email: 'damla@example.com', ...(ageConfirmed === undefined ? {} : { ageConfirmed }) },
  };
}

function problem(status: number, code: string, extra: Record<string, unknown> = {}) {
  return new ApiError('http', status, { status, code, ...extra });
}

async function pickYear(year: number) {
  await fireEvent.press(screen.getByTestId('birth.year'));
  await waitFor(() => expect(screen.getByTestId(`birth.yearSheet.option.${year}`)).toBeTruthy(), WAIT);
  await fireEvent.press(screen.getByTestId(`birth.yearSheet.option.${year}`));
  await fireEvent.press(screen.getByTestId('birth.yearSheet.select'));
}

async function fillForm() {
  await waitFor(() => expect(screen.getByTestId('birth.year')).toBeTruthy(), WAIT);
  await fireEvent.changeText(screen.getByTestId('auth.name'), 'Damla');
  await fireEvent.changeText(screen.getByTestId('auth.email'), 'damla@example.com');
  await fireEvent.changeText(screen.getByTestId('auth.password'), 'Sm0keTest2026');
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockStored = null;
  teenStore.reset();
  resetAgeFixtures(true);
  mockApi.mockImplementation(async () => {
    throw new ApiError('config', null, null);
  });
  await AsyncStorage.clear();
  await onboardingStore.markDone('u1');
  await i18n.changeLanguage('en');
});

describe('02 sign-up: birth year instead of the 18+ box (canvas 18)', () => {
  it('the year is required; an adult year registers with birthYear and ageConfirmed', async () => {
    await renderRouter('./src/app', { initialUrl: '/start?mode=register' });
    await fillForm();
    expect(screen.queryByTestId('age.checkbox')).toBeNull();
    expect(screen.getByTestId('birth.hint')).toHaveTextContent('We ask so the app fits your age. It never shows on your profile.');
    expect(screen.getByText('Terms of Use')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('auth.submit'));
    await waitFor(() => expect(screen.getByText('Choose your year of birth.')).toBeTruthy(), WAIT);
    expect(mockRegister).not.toHaveBeenCalled();

    await pickYear(YEAR - 30);
    await fireEvent.press(screen.getByTestId('auth.submit'));
    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1), WAIT);
    expect(mockRegister.mock.calls[0][0]).toEqual({
      name: 'Damla',
      email: 'damla@example.com',
      password: 'Sm0keTest2026',
      birthYear: YEAR - 30,
      ageConfirmed: true,
      ageBand: 'adult',
    });
  });

  it('under 16: the kind refusal, and nothing is sent', async () => {
    await renderRouter('./src/app', { initialUrl: '/start?mode=register' });
    await fillForm();
    await pickYear(YEAR - 13);
    await fireEvent.press(screen.getByTestId('auth.submit'));
    await waitFor(() => expect(screen.getByTestId('teen.under.email')).toBeTruthy(), WAIT);
    expect(screen.getByText('You can join Droblet from age 16')).toBeTruthy();
    expect(mockRegister).not.toHaveBeenCalled();
    // "I picked the wrong year" goes back to the form with the year cleared.
    await fireEvent.press(screen.getByTestId('teen.under.fix'));
    await waitFor(() => expect(screen.getByTestId('birth.year')).toHaveTextContent(/Choose/), WAIT);
  });

  it('16–17: the hint, then 02h before the account exists; continuing registers a teen without the 18+ flag', async () => {
    await renderRouter('./src/app', { initialUrl: '/start?mode=register' });
    await fillForm();
    await pickYear(YEAR - 17);
    expect(screen.getByTestId('birth.hint')).toHaveTextContent(/16 and 17 year olds can join with a parent's approval/);
    await fireEvent.press(screen.getByTestId('auth.submit'));
    await waitFor(() => expect(screen.getByTestId('teen.intro')).toBeTruthy(), WAIT);
    expect(screen.getByText('A parent needs to approve')).toBeTruthy();
    expect(screen.getByText('No social, no shopping')).toBeTruthy();
    expect(mockRegister).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('teen.intro.continue'));
    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1), WAIT);
    expect(mockRegister.mock.calls[0][0]).toEqual({
      name: 'Damla',
      email: 'damla@example.com',
      password: 'Sm0keTest2026',
      birthYear: YEAR - 17,
      ageBand: 'teen',
    });
  });

  it('a year that can mean 15 or 16 asks the month first', async () => {
    await renderRouter('./src/app', { initialUrl: '/start?mode=register' });
    await fillForm();
    await pickYear(YEAR - 16);
    expect(screen.getByTestId('birth.month')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('auth.submit'));
    await waitFor(() => expect(screen.getByText('Choose your month of birth.')).toBeTruthy(), WAIT);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('teen sign-up closed on the server: the "coming soon" screen', async () => {
    mockRegister.mockImplementation((_body: unknown, opts: { onError: (e: unknown) => void }) => opts.onError(problem(422, 'teen_not_available')));
    await renderRouter('./src/app', { initialUrl: '/start?mode=register' });
    await fillForm();
    await pickYear(YEAR - 17);
    await fireEvent.press(screen.getByTestId('auth.submit'));
    await waitFor(() => expect(screen.getByTestId('teen.intro')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('teen.intro.continue'));
    await waitFor(() => expect(screen.getByTestId('teen.under.closed')).toBeTruthy(), WAIT);
    expect(screen.getByText('Teen accounts are coming soon')).toBeTruthy();
  });

  it('the login tab has no birth year', async () => {
    await renderRouter('./src/app', { initialUrl: '/start?mode=login' });
    await waitFor(() => expect(screen.getByText('Welcome back')).toBeTruthy(), WAIT);
    expect(screen.queryByTestId('birth.year')).toBeNull();
  });
});

describe('02f birth year after Apple / Google', () => {
  it('an account without an age sees 02f before anything else; an adult year continues', async () => {
    signedIn(false);
    resetAgeFixtures(false);
    mockApi.mockImplementation(async (path: string, opts?: { body?: unknown }) => {
      if (path === 'v1/tenant/profile/age-confirmation') {
        expect(opts?.body).toEqual({ birthYear: YEAR - 40 });
        return { ...PROFILE, ageConfirmedAt: '2026-11-21T09:00:00Z', ageBand: 'adult', teen: null };
      }
      throw new ApiError('config', null, null);
    });
    await renderRouter('./src/app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('age-confirm')).toBeTruthy(), WAIT);
    expect(screen).toHavePathname('/age-confirm');
    expect(screen.getByText('Before you continue')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('age.confirm'));
    await waitFor(() => expect(screen.getByText('Choose your year of birth.')).toBeTruthy(), WAIT);
    await pickYear(YEAR - 40);
    await fireEvent.press(screen.getByTestId('age.confirm'));
    await waitFor(() => expect(screen.queryByTestId('age-confirm')).toBeNull(), WAIT);
    expect(sessionStore.getState()).toMatchObject({ status: 'signedIn', user: { ageConfirmed: true, ageBand: 'adult' } });
  });

  it('under 16: the server closes the account; 02g says so and signs out', async () => {
    signedIn(false);
    resetAgeFixtures(false);
    mockApi.mockImplementation(async (path: string) => {
      if (path === 'v1/tenant/profile/age-confirmation') throw problem(422, 'age_under_minimum', { accountDeleted: true });
      throw new ApiError('config', null, null);
    });
    await renderRouter('./src/app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('age-confirm')).toBeTruthy(), WAIT);
    await pickYear(YEAR - 12);
    await fireEvent.press(screen.getByTestId('age.confirm'));
    await waitFor(() => expect(screen.getByTestId('teen.under.social')).toBeTruthy(), WAIT);
    expect(screen.getByText(/We've deleted the account created with Apple or Google/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('teen.under.primary'));
    await waitFor(() => expect(sessionStore.getState().status).toBe('signedOut'), WAIT);
  });

  it('16–17: 02h first, then the year is sent and the teen lands on the parent e-mail step', async () => {
    signedIn(false);
    resetAgeFixtures(false);
    mockApi.mockImplementation(async (path: string) => {
      if (path === 'v1/tenant/profile/age-confirmation')
        return {
          ...PROFILE,
          ageConfirmedAt: '2026-11-21T09:00:00Z',
          ageBand: 'teen',
          teen: { status: 'pendingParentalConsent', request: { state: 'none' } },
        };
      if (path === 'v1/tenant/teen') return { ageBand: 'teen', teen: { status: 'pendingParentalConsent', request: { state: 'none' } } };
      throw new ApiError('config', null, null);
    });
    await renderRouter('./src/app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('age-confirm')).toBeTruthy(), WAIT);
    await pickYear(YEAR - 17);
    await fireEvent.press(screen.getByTestId('age.confirm'));
    await waitFor(() => expect(screen.getByTestId('teen.intro')).toBeTruthy(), WAIT);
    expect(mockApi).not.toHaveBeenCalledWith('v1/tenant/profile/age-confirmation', expect.anything());
    await fireEvent.press(screen.getByTestId('teen.intro.continue'));
    await waitFor(() => expect(screen.getByTestId('teen.parent')).toBeTruthy(), WAIT);
    expect(screen).toHavePathname('/teen/parent');
  });

  it('other routes redirect to 02f too', async () => {
    signedIn(false);
    await renderRouter('./src/app', { initialUrl: '/settings' });
    await waitFor(() => expect(screen.getByTestId('age-confirm')).toBeTruthy(), WAIT);
  });

  it('a session stored before the check asks the profile once; an account without an age is then routed', async () => {
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
  const profile = {
    tenantId: 't',
    displayName: null,
    handle: null,
    email: null,
    closetVisibility: 'private' as const,
    language: 'tr',
    cityId: null,
    version: 1,
    updatedAt: '',
  };
  it('reads the profile field; unknown when the server does not send it', () => {
    expect(ageConfirmedOf({ ...profile, ageConfirmedAt: '2026-11-19T09:00:00Z' })).toBe(true);
    expect(ageConfirmedOf({ ...profile, ageConfirmedAt: null })).toBe(false);
    expect(ageConfirmedOf(profile)).toBeUndefined();
    expect(ageConfirmedOf(null)).toBeUndefined();
  });
});
