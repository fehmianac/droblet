import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import type { TryOnResult } from '@/api/contracts/tryon';
import { fixtureDb, resetFixtureDb } from '@/fixtures/db';
import { fixtureJobOptions, resetFixtureJobs, startFixtureJob } from '@/fixtures/jobs';
import { resetUploads } from '@/features/outfitImport/uploader';
import { photoTryOnParams, photoTryOnTarget } from '@/features/tryon/usePhotoTryOn';

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
jest.mock('@/features/photos/preparePhoto', () => ({ preparePhoto: jest.fn(), deleteLocalPhoto: jest.fn() }));

/** The system picker: always hands back `count` prepared photos (no camera, no library in tests). */
const mockPicker = { count: 1 };
jest.mock('@/features/photos/usePhotoPicker', () => ({
  usePhotoPicker: (options: { onPicked: (photos: { uploadId: string; localUri: string; width: number; height: number }[]) => void }) => {
    const pick = () => options.onPicked(Array.from({ length: mockPicker.count }, (_, i) => ({ uploadId: `u${i}`, localUri: `file:///outfit-${i}.jpg`, width: 1200, height: 1600 })));
    return { takePhoto: pick, chooseFromLibrary: pick, sheet: null };
  },
}));

const WAIT = { timeout: 8000 };

async function open(initialUrl: string) {
  await AsyncStorage.removeItem('droblet.query.u1');
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
  await renderRouter('./src/app', { initialUrl });
}

const photoResult = (): TryOnResult => ({
  tryOnId: 'tp1',
  target: { kind: 'photo', id: 'up1' },
  imageUrl: 'https://img.test/tryon.webp',
  creditsRemaining: 10,
  referenceUrl: 'https://img.test/ref.jpg',
});

beforeEach(async () => {
  resetFixtureDb();
  resetFixtureJobs();
  resetUploads();
  mockPicker.count = 1;
  await AsyncStorage.clear();
});

describe('outfit-photo try-on targets', () => {
  it('a draft and an import photo need no upload; a local photo becomes the uploaded photo (fixtures: its uri)', async () => {
    await expect(photoTryOnTarget({ kind: 'draft', draftId: 'd1', uri: 'file:///a.jpg' })).resolves.toEqual({ kind: 'photo', id: 'd1' });
    await expect(photoTryOnTarget({ kind: 'import', sessionId: 's1', index: 3 })).resolves.toEqual({ kind: 'import-photo', id: 's1:3' });
    await expect(photoTryOnTarget({ kind: 'local', uri: 'file:///a.jpg' })).resolves.toEqual({ kind: 'photo', id: 'file:///a.jpg' });
    expect(photoTryOnParams('j1', { kind: 'photo', id: 'd1' }, { kind: 'draft', draftId: 'd1', uri: 'file:///a.jpg' })).toEqual({
      jobId: 'j1',
      kind: 'photo',
      id: 'd1',
      mode: 'photo',
      ref: 'file:///a.jpg',
      draftId: 'd1',
    });
  });
});

describe('16c / 16d — "Bir kombin fotoğrafını üzerimde dene" on the stylist hub', () => {
  it('the card opens the photo source sheet; the picked photo opens 16d', async () => {
    await open('/stylist');
    await waitFor(() => expect(screen.getByTestId('stylist.outfitPhoto')).toBeTruthy(), WAIT);
    expect(screen.getByText('Try an outfit photo on me')).toBeTruthy();
    expect(screen.getByText('The whole outfit in the photo, on you · 1 credit')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('stylist.outfitPhoto'));
    await waitFor(() => expect(screen.getByText('Choose an outfit photo')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('photoSource.outfit.library'));
    await waitFor(() => expect(screen).toHavePathname('/tryon/photo'), WAIT);
    expect(screen.getByText("Let's show this outfit on you")).toBeTruthy();
    expect(screen.getByText('SOURCE PHOTO')).toBeTruthy();
  }, 30_000);

  it('16d: requirements → 1-credit confirmation → the try-on job of the photo', async () => {
    await open('/tryon/photo?uri=file%3A%2F%2F%2Foutfit-0.jpg&w=1200&h=1600');
    await waitFor(() => expect(screen.getByTestId('tryonPhoto.tryOn')).toBeTruthy(), WAIT);
    expect(screen.getByText('Choose another photo')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('tryonPhoto.tryOn'));
    await waitFor(() => expect(screen.getByText('1 credit will be used')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('credit-confirm'));
    await waitFor(() => expect(screen).not.toHavePathname('/tryon/photo'), WAIT);
    expect(fixtureDb.entitlement.credits.remaining).toBe(10);
  }, 30_000);
});

describe('16e / 16f — the result of an outfit-photo try-on', () => {
  it('shows the source photo, "Parçalara ayır ve gardıroba ekle", share and Done', async () => {
    const jobId = startFixtureJob('tryon', photoResult, { id: 'job_tp1', durationMs: 10 });
    await open(`/tryon/${jobId}?mode=photo&kind=photo&id=up1&ref=file%3A%2F%2F%2Foutfit-0.jpg`);
    await waitFor(() => expect(screen.getByText('The outfit in the photo, on you')).toBeTruthy(), WAIT);
    expect(screen.getByText('Source photo')).toBeTruthy();
    expect(screen.getByLabelText('Enlarge the source photo')).toBeTruthy();
    expect(screen.getByText('Split into pieces and add to wardrobe')).toBeTruthy();
    expect(screen.getByLabelText('Share')).toBeTruthy();
    expect(screen.getByTestId('tryon.done')).toBeTruthy();
  }, 30_000);

  it('opened from "Parçaları seç": splitting goes back to the same photo; without a photo on the device it is not offered', async () => {
    const jobId = startFixtureJob('tryon', () => ({ ...photoResult(), referenceUrl: null }), { id: 'job_tp2', durationMs: 10 });
    await open(`/tryon/${jobId}?mode=photo&kind=photo&id=up1&ref=https%3A%2F%2Fimg.test%2Fremote.jpg`);
    await waitFor(() => expect(screen.getByText('The outfit in the photo, on you')).toBeTruthy(), WAIT);
    expect(screen.queryByTestId('tryon.split')).toBeNull();
    expect(screen.getByText('Source photo')).toBeTruthy(); // the signed URL of the route
  }, 30_000);

  it('a refused outfit photo says why, the credit was refunded, and offers another photo', async () => {
    fixtureJobOptions.failNext = { code: 'guard_rejected', creditRefunded: true, reference: 'noClothing' };
    const jobId = startFixtureJob('tryon', photoResult, { id: 'job_tp3', durationMs: 10 });
    await open(`/tryon/${jobId}?mode=photo&kind=photo&id=up1&ref=file%3A%2F%2F%2Foutfit-0.jpg`);
    await waitFor(() => expect(screen.getByText("We couldn't see an outfit in this photo")).toBeTruthy(), WAIT);
    expect(screen.getByText('Choose a photo of one person with their clothes in view. Your credit was refunded.')).toBeTruthy();
    expect(screen.getByText('Only one person in the photo')).toBeTruthy();
    expect(screen.getByTestId('tryon.referenceRejected.other')).toBeTruthy();
  }, 30_000);

  it('a minor in the outfit photo: the photo cannot be used, no tips', async () => {
    fixtureJobOptions.failNext = { code: 'guard_rejected', creditRefunded: true, reference: 'minor' };
    const jobId = startFixtureJob('tryon', photoResult, { id: 'job_tp4', durationMs: 10 });
    await open(`/tryon/${jobId}?mode=photo&kind=import-photo&id=s1%3A2`);
    await waitFor(() => expect(screen.getByText("We can't use this photo")).toBeTruthy(), WAIT);
    expect(screen.queryByText('Only one person in the photo')).toBeNull();
  }, 30_000);
});

describe('31c+ — "Üzerimde dene" on an outfit import photo', () => {
  it('each ready photo offers it; it starts the try-on behind the credit confirmation', async () => {
    mockPicker.count = 2;
    await open('/import');
    await waitFor(() => expect(screen.getByText('You can choose up to 30 photos')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('import.pick'));
    await waitFor(() => expect(screen.getByTestId('import.look.1.tryon')).toBeTruthy(), WAIT);
    expect(screen.getByLabelText('Photo 2: try it on me whole')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('import.look.1.tryon'));
    // The same requirements engine and 07b sheet as every try-on (nothing is charged before it is confirmed).
    await waitFor(() => expect(screen.getByText('1 credit will be used')).toBeTruthy(), WAIT);
    expect(fixtureDb.entitlement.credits.remaining).toBe(11);
  }, 30_000);
});
