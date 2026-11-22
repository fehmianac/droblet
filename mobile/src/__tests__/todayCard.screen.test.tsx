import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

import type { TryOnResult } from '@/api/contracts/tryon';
import { resetFixtureDb } from '@/fixtures/db';
import { resetFixtureJobs, startFixtureJob } from '@/fixtures/jobs';
import { tryOnRuns } from '@/features/tryon/runs';

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

/** What the existing-image check answers for the look of the day (fixture mode answers null). */
let mockExisting: TryOnResult | null = null;
jest.mock('@/features/tryon/api', () => {
  const actual = jest.requireActual('@/features/tryon/api');
  const { useTryOnPhotoKey } = jest.requireActual('@/features/tryon/photoKey');
  const { useQuery } = jest.requireActual('@tanstack/react-query');
  return {
    ...actual,
    useExistingTryOn: (target: unknown, options: { enabled?: boolean } = {}) => {
      const key = useTryOnPhotoKey();
      const query = useQuery(actual.existingTryOnQuery(target, options.enabled ?? true, key));
      const answer = key === undefined ? undefined : (query.data ?? mockExisting);
      return { data: actual.currentTryOn(answer, key), isFetching: false, isError: false };
    },
  };
});

const LOOK = 'look_lacivert_blazer';
const WAIT = { timeout: 6000 };
const image = (extra: Partial<TryOnResult> = {}): TryOnResult => ({
  tryOnId: 'img_1',
  target: { kind: 'look', id: LOOK },
  imageUrl: 'https://img.test/look.jpg',
  creditsRemaining: null,
  source: 'body',
  ...extra,
});

beforeEach(async () => {
  resetFixtureDb();
  resetFixtureJobs();
  tryOnRuns.reset();
  mockExisting = null;
  await AsyncStorage.clear();
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
});

async function openToday() {
  await renderRouter('./src/app', { initialUrl: '/today' });
  await waitFor(() => expect(screen.getByTestId('today-look-card')).toBeTruthy(), WAIT);
}

describe('06 Bugünün kombini — the 14b layout in every state', () => {
  it('with an image: the image whole and AI-tagged on the left, the pieces on the right, no invitation', async () => {
    mockExisting = image();
    await openToday();
    await waitFor(() => expect(screen.getByText('ON YOU')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('on-you-tag')).toBeTruthy();
    expect(screen.queryByTestId('today-look-invite')).toBeNull();
    expect(screen.getByTestId('today-look-pieces')).toBeTruthy();
  });

  it('without an image: the invitation is one opaque, labelled button beside the pieces', async () => {
    await openToday();
    await waitFor(() => expect(screen.getByTestId('today-look-invite')).toBeTruthy(), WAIT);
    const tile = screen.getByTestId('today-look-invite');
    expect(tile).toHaveProp('accessibilityRole', 'button');
    expect(tile).toHaveProp('accessibilityLabel', 'Try it on me. How would this look sit on you? Try it on me · 1 credit');
    expect(String(tile.props.className)).toMatch(/\bbg-sand\b/);
    expect(String(tile.props.className)).not.toMatch(/bg-transparent|border-ink/);
    expect(screen.getByTestId('today-look-pieces')).toBeTruthy();
    expect(screen.queryByText('Piece collage')).toBeNull();
  });

  it('generating: the AI loading state on the left while this look\'s image is made', async () => {
    const jobId = startFixtureJob<TryOnResult>('tryon', () => image({ tryOnId: 'img_new' }), { durationMs: 60_000 });
    tryOnRuns.record({ kind: 'look', id: LOOK }, jobId);
    await openToday();
    await waitFor(() => expect(screen.getByTestId('today-look-generating')).toBeTruthy(), WAIT);
    expect(screen.getByText('ON YOU · IN PROGRESS')).toBeTruthy();
    expect(screen.queryByTestId('today-look-invite')).toBeNull();
    expect(screen.getByTestId('today-look-pieces')).toBeTruthy();
  });
});
