import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import type { TryOnResult } from '@/api/contracts/tryon';
import { resetFixtureDb } from '@/fixtures/db';
import { fixtureJobOptions, resetFixtureJobs, startFixtureJob } from '@/fixtures/jobs';
import { tryOnPieces } from '@/features/tryon/pieces';

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
  tryOnPieces.clear();
  await AsyncStorage.clear();
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
});

describe('tryon/[jobId] — "Üzerimde gör"', () => {
  it('shows the curtain wait (card, heading, credit line, background action), then opens it on the result', async () => {
    const jobId = startFixtureJob('tryon', result, { id: 'job_t1', durationMs: 900 });
    await renderRouter('./src/app', { initialUrl: `/tryon/${jobId}?title=Lacivert%20Blazer&kind=look&id=look_lacivert_blazer` });

    await waitFor(() => expect(screen.getByText('TRY IT ON ME')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('tryon.curtain.card')).toBeTruthy();
    expect(screen.getByText('Getting ready')).toBeTruthy();
    // Opened without the start answer (no pieces known): one "Outfit" row.
    expect(screen.getByText('Putting on Outfit…')).toBeTruthy();
    expect(screen.getByText('Lacivert Blazer is in the fitting room')).toBeTruthy();
    expect(screen.getByText("Being made on your photo. It usually takes 20–40 seconds; the curtain opens when it's ready.")).toBeTruthy();
    expect(screen.getByLabelText("Continue in the background — we'll let you know when it's done")).toBeTruthy();
    await waitFor(() => expect(screen.getByText('1 credit · 11 left')).toBeTruthy(), WAIT);

    // The result is in: every row ✓ and "Ready", then the curtain opens and the result layout follows.
    await waitFor(() => expect(screen.getByText('Ready')).toBeTruthy(), WAIT);
    expect(screen.getByText('Outfit on')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Lacivert Blazer on you')).toBeTruthy(), WAIT);
    expect(screen.getByText('You have 10 images left this month.')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
  }, 30_000);

  it('a tap on the curtain during the reveal skips straight to the result', async () => {
    const jobId = startFixtureJob('tryon', result, { id: 'job_t4', durationMs: 300 });
    await renderRouter('./src/app', { initialUrl: `/tryon/${jobId}?title=Lacivert%20Blazer&kind=look&id=look_lacivert_blazer` });
    await waitFor(() => expect(screen.getByText('Ready')).toBeTruthy(), WAIT);
    expect(screen.queryByText('Lacivert Blazer on you')).toBeNull();
    await fireEvent.press(screen.getByTestId('tryon.curtain.skip'));
    // Well inside the ~1.2 s reveal.
    await waitFor(() => expect(screen.getByText('Lacivert Blazer on you')).toBeTruthy(), { timeout: 600 });
    expect(screen.queryByTestId('tryon.curtain.skip')).toBeNull();
  }, 30_000);

  it('lists the outfit pieces by their own names, puts them on one by one, bags are "added"', async () => {
    const jobId = startFixtureJob('tryon', result, { id: 'job_t3', durationMs: 60_000 });
    tryOnPieces.record(jobId, [
      { name: 'Navy Wool Blazer', category: 'outerwear' },
      { name: 'Beige Trousers', category: 'bottom' },
      { name: null, category: 'shoes' },
      { name: 'Leather Shoulder Bag', category: 'bag' },
      { name: 'Silk Scarf', category: 'accessory' },
    ]);
    await renderRouter('./src/app', { initialUrl: `/tryon/${jobId}?title=Office` });

    await waitFor(() => expect(screen.getByText('Putting on Navy Wool Blazer…')).toBeTruthy(), WAIT);
    expect(screen.getByText('Beige Trousers')).toBeTruthy();
    // No name: the category label.
    expect(screen.getByText('Shoes')).toBeTruthy();
    expect(screen.getByText('Leather Shoulder Bag')).toBeTruthy();
    // Four rows at most.
    expect(screen.queryByText('Silk Scarf')).toBeNull();
    expect(screen.getByText('and 1 more piece')).toBeTruthy();
    expect(screen.getAllByTestId('tryon.curtain.row.active')).toHaveLength(1);
  }, 30_000);

  it('a failed job says the credit was refunded and offers one retry', async () => {
    fixtureJobOptions.failNext = { code: 'generation_failed', creditRefunded: true };
    const jobId = startFixtureJob('tryon', result, { id: 'job_t2', durationMs: 10 });
    await renderRouter('./src/app', { initialUrl: `/tryon/${jobId}` });
    await waitFor(() => expect(screen.getByText("We couldn't create it right now. Your credit was refunded.")).toBeTruthy(), WAIT);
    expect(screen.getByText('Try again')).toBeTruthy();
  }, 30_000);
});
