import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import type { TryOnResult } from '@/api/contracts/tryon';
import { resetFixtureDb } from '@/fixtures/db';
import { fixtureJobOptions, resetFixtureJobs, startFixtureJob } from '@/fixtures/jobs';
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

/**
 * What `GET v1/tenant/tryon?kind=look&id=` answers in this test. The real stale-photo rule (`currentTryOn` with the
 * user's current photo key) still runs on it: the fixture user has a full-length photo. The real query still runs
 * (fixture mode answers null), so an image a finished job writes into it shows.
 */
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

async function openLook() {
  await renderRouter('./src/app', { initialUrl: `/look/${LOOK}` });
  await waitFor(() => expect(screen.getByTestId('look-hero')).toBeTruthy(), WAIT);
}

describe('14b Look detayı — hero (06 layout: on-you area left, pieces right)', () => {
  it('without an image: the invitation on the left, every piece once on the right, no collage', async () => {
    await openLook();
    await waitFor(() => expect(screen.getByTestId('look-hero-invite')).toBeTruthy(), WAIT);
    expect(screen.getByText('How would this look sit on you?')).toBeTruthy();
    // Ready user: the tile says what a tap costs.
    expect(screen.getByTestId('look-hero-invite-footer')).toHaveTextContent('Try it on me · 1 credit');
    expect(screen.queryByTestId('look-hero-image')).toBeNull();
    expect(screen.queryByTestId('image-slot-collage')).toBeNull();
    // 3 pieces → 3 tiles, no "+N".
    expect(screen.queryByTestId('look-hero-more')).toBeNull();
    expect(screen.queryByTestId('look-try-on-ready')).toBeNull();
  });

  it('with an image on the current photo: the image (whole, AI-tagged), "Try it on me" opens it without a credit', async () => {
    mockExisting = image();
    await openLook();
    await waitFor(() => expect(screen.getByTestId('look-hero-image')).toBeTruthy(), WAIT);
    expect(screen.getByText('ON YOU')).toBeTruthy();
    expect(screen.getByText('AI preview')).toBeTruthy();
    expect(screen.queryByTestId('look-hero-invite')).toBeNull();
    expect(screen.getByTestId('look-try-on-ready')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('look-try-on'));
    await waitFor(() => expect(screen).toHavePathname('/tryon/img:img_1'), WAIT);
    expect(screen.queryByTestId('credit-confirm')).toBeNull();
  });

  it('stale photo: an image made on the face path while a full-length photo exists counts as no image', async () => {
    mockExisting = image({ source: 'face' });
    await openLook();
    await waitFor(() => expect(screen.getByTestId('look-hero-invite')).toBeTruthy(), WAIT);
    expect(screen.queryByTestId('look-hero-image')).toBeNull();
    expect(screen.queryByTestId('look-try-on-ready')).toBeNull();
  });

  it('generating: the AI loading state on the left, then the image takes its place', async () => {
    fixtureJobOptions.tryOnImageUrl = 'https://img.test/new.jpg';
    const jobId = startFixtureJob<TryOnResult>('tryon', () => image({ tryOnId: 'img_new', imageUrl: 'https://img.test/new.jpg' }), { durationMs: 1500 });
    tryOnRuns.record({ kind: 'look', id: LOOK }, jobId);
    await openLook();
    expect(screen.getByTestId('look-hero-generating')).toBeTruthy();
    expect(screen.getByText('ON YOU · IN PROGRESS')).toBeTruthy();
    expect(screen.getByTestId('look-try-on')).toBeDisabled();
    expect(screen.getByTestId('look-try-on-preparing')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('look-hero-image')).toBeTruthy(), { timeout: 10_000 });
    expect(screen.queryByTestId('look-hero-generating')).toBeNull();
    await act(async () => undefined);
    expect(tryOnRuns.get({ kind: 'look', id: LOOK })).toBeNull();
  }, 30_000);
});
