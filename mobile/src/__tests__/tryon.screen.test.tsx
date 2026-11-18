import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

import type { TryOnResult } from '@/api/contracts/tryon';
import { resetFixtureDb } from '@/fixtures/db';
import { fixtureJobOptions, resetFixtureJobs, startFixtureJob } from '@/fixtures/jobs';

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

const WAIT = { timeout: 8000 };
const result = (): TryOnResult => ({ tryOnId: 't1', target: { kind: 'look', id: 'look_lacivert_blazer' }, imageUrl: null, creditsRemaining: 10 });

beforeEach(async () => {
  resetFixtureDb();
  resetFixtureJobs();
  await AsyncStorage.clear();
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
});

describe('tryon/[jobId] — "Üzerimde gör"', () => {
  it('shows the wait (stage, progress line, credit line, background action), then the result', async () => {
    const jobId = startFixtureJob('tryon', result, { id: 'job_t1', durationMs: 900 });
    await renderRouter('./src/app', { initialUrl: `/tryon/${jobId}?title=Lacivert%20Blazer&kind=look&id=look_lacivert_blazer` });

    await waitFor(() => expect(screen.getByText('TRY IT ON ME')).toBeTruthy(), WAIT);
    expect(screen.getByText('Getting the pieces ready…')).toBeTruthy();
    expect(screen.getByText('ON YOU · IN PROGRESS')).toBeTruthy();
    expect(screen.getByText('Lacivert Blazer is being prepared on your photo. It usually takes 20–40 seconds.')).toBeTruthy();
    expect(screen.getByLabelText("Continue in the background — we'll let you know when it's done")).toBeTruthy();
    await waitFor(() => expect(screen.getByText('1 credit · 11 left')).toBeTruthy(), WAIT);

    await waitFor(() => expect(screen.getByText('Lacivert Blazer on you')).toBeTruthy(), WAIT);
    expect(screen.getByText('You have 10 images left this month.')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
  }, 30_000);

  it('a failed job says the credit was refunded and offers one retry', async () => {
    fixtureJobOptions.failNext = { code: 'generation_failed', creditRefunded: true };
    const jobId = startFixtureJob('tryon', result, { id: 'job_t2', durationMs: 10 });
    await renderRouter('./src/app', { initialUrl: `/tryon/${jobId}` });
    await waitFor(() => expect(screen.getByText("We couldn't create it right now. Your credit was refunded.")).toBeTruthy(), WAIT);
    expect(screen.getByText('Try again')).toBeTruthy();
  }, 30_000);
});
