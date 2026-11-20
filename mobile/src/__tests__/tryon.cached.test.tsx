import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { fixtureDb, resetFixtureDb } from '@/fixtures/db';
import { resetFixtureJobs, fixtureJobOptions } from '@/fixtures/jobs';
import { startFixtureStylistOutfit } from '@/fixtures/stylist';
import { toIsoDate } from '@/lib/format';

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

/** What `GET v1/tenant/tryon?kind=&id=` answers in this test: an image, none (404), or a failure / offline. */
let mockExisting: 'cached' | 'none' | 'failed' = 'none';
const mockImage = { tryOnId: 'img_cached', target: { kind: 'suggestion', id: 'x' }, imageUrl: 'https://img.test/cached.jpg', creditsRemaining: null };

jest.mock('@/features/tryon/api', () => {
  const actual = jest.requireActual('@/features/tryon/api');
  return {
    ...actual,
    useExistingTryOn: () =>
      mockExisting === 'cached'
        ? { data: mockImage, isFetching: false, isError: false }
        : mockExisting === 'none'
          ? { data: null, isFetching: false, isError: false }
          : { data: undefined, isFetching: false, isError: true },
  };
});
jest.mock('@/api/wire/tryon', () => ({
  ...jest.requireActual('@/api/wire/tryon'),
  requestTryOnImage: jest.fn(async () => mockImage),
}));

const WAIT = { timeout: 6000 };

beforeEach(async () => {
  resetFixtureDb();
  resetFixtureJobs();
  fixtureJobOptions.durationMs = 50;
  await AsyncStorage.clear();
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
});

async function openSuggestion(requestId: string) {
  const { jobId } = startFixtureStylistOutfit({ requestId, date: toIsoDate(new Date()), occasion: 'dinner', text: null, cityId: null, wardrobeOnly: true });
  await renderRouter('./src/app', { initialUrl: `/stylist/${jobId}` });
  await waitFor(() => expect(screen.getByText('Try it on me · 1 credit')).toBeTruthy(), WAIT);
}

describe('13d — an existing try-on image opens without the credit sheet', () => {
  it('cached: no "1 credit" sheet, the image shows with "Made earlier · no credit used", nothing is charged', async () => {
    mockExisting = 'cached';
    await openSuggestion('cached');
    const credits = fixtureDb.entitlement.credits.remaining;
    await fireEvent.press(screen.getByText('Try it on me · 1 credit'));
    await waitFor(() => expect(screen.getByTestId('tryon.cachedNote')).toBeTruthy(), WAIT);
    expect(screen.getByText('Made earlier · no credit used')).toBeTruthy();
    expect(screen.queryByTestId('credit-confirm')).toBeNull();
    expect(fixtureDb.entitlement.credits.remaining).toBe(credits);
  }, 30_000);

  it('uncached: the credit confirmation opens as before', async () => {
    mockExisting = 'none';
    await openSuggestion('uncached');
    await fireEvent.press(screen.getByText('Try it on me · 1 credit'));
    await waitFor(() => expect(screen.getByTestId('credit-confirm')).toBeTruthy(), WAIT);
    expect(screen.queryByTestId('tryon.cachedNote')).toBeNull();
  }, 30_000);

  it('check failed / offline: falls back to the credit confirmation', async () => {
    mockExisting = 'failed';
    await openSuggestion('failed');
    await fireEvent.press(screen.getByText('Try it on me · 1 credit'));
    await waitFor(() => expect(screen.getByTestId('credit-confirm')).toBeTruthy(), WAIT);
  }, 30_000);
});
