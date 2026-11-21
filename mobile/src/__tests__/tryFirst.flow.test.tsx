import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

import { DATA_SOURCE } from '@/api/dataSource';
import { resetFixtureDb } from '@/fixtures/db';
import { fixtureDraftOptions, fixtureListDrafts, resetFixtureDrafts } from '@/fixtures/wardrobe';
import { sharedPhotoStore } from '@/features/share/sharedPhoto';
import { photoExplainerKey } from '@/features/tryon/photoExplainer';
import { photoTryOnParams, resolvePhotoTryOn } from '@/features/tryon/usePhotoTryOn';
import { useStartItemDrafts } from '@/features/wardrobe/mutations';

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

type MockPermission = { granted: boolean; canAskAgain: boolean } | null;
const mockCamera = jest.requireMock<{ __camera: { permission: MockPermission; request: jest.Mock; take: jest.Mock } }>('expo-camera').__camera;

jest.mock('@/features/photos/preparePhoto', () => ({
  preparePhoto: jest.fn(async (uri: string, width: number, height: number) => ({ uploadId: 'up_shot', localUri: uri, width, height })),
  deleteLocalPhoto: jest.fn(),
}));
/** The system picker hands back one outfit photo from the library. */
jest.mock('@/features/photos/usePhotoPicker', () => ({
  usePhotoPicker: (options: { onPicked: (photos: { uploadId: string; localUri: string; width: number; height: number }[]) => void }) => {
    const pick = () => options.onPicked([{ uploadId: 'up_lib', localUri: 'file:///library-outfit.jpg', width: 1200, height: 1600 }]);
    return { takePhoto: pick, chooseFromLibrary: pick, sheet: null };
  },
}));

/** The API client, for the one test that runs the wardrobe calls against "the API". */
const mockApi = jest.fn();
jest.mock('@/api/client', () => ({ ...jest.requireActual('@/api/client'), apiRequest: (...args: unknown[]) => mockApi(...args) }));

const WAIT = { timeout: 8000 };

async function open(initialUrl: string) {
  await AsyncStorage.removeItem('droblet.query.u1');
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
  await renderRouter('./src/app', { initialUrl });
}

/** The options of the choice, top to bottom (tree order). */
function optionOrder(): string[] {
  return screen.getAllByTestId(/^tryFirst\.(tryOn|split)$/).map((el) => el.props.testID as string);
}

/** The stored 16d flag, once the screen's write has landed (an async waitFor callback would overlap act scopes). */
async function explainerFlag(): Promise<string | null> {
  for (let i = 0; i < 20; i += 1) {
    const value = await AsyncStorage.getItem(photoExplainerKey('u1'));
    if (value) return value;
    await act(async () => undefined);
  }
  return AsyncStorage.getItem(photoExplainerKey('u1'));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetFixtureDb();
  resetFixtureDrafts();
  sharedPhotoStore.reset();
  fixtureDraftOptions.baseMs = 0;
  mockCamera.permission = { granted: true, canAskAgain: true };
  mockCamera.take.mockReset();
  mockCamera.take.mockImplementation(async () => ({ uri: 'file:///shot.jpg', width: 1200, height: 1600 }));
});

describe('12+ — "Önce üzerimde dene" / "Parçalarına ayır" right after a photo', () => {
  it('a camera shot skips the choice and goes straight to recognition and the form (canvas n_ux1 A1)', async () => {
    await open('/item/add');
    await waitFor(() => expect(screen.getByTestId('item-add-camera')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('item-add-shutter'));
    await waitFor(() => expect(fixtureListDrafts()).toHaveLength(1), WAIT);
    expect(screen.queryByTestId('tryFirst.sheet')).toBeNull();
    await waitFor(() => expect(screen).toHavePathname('/item/form'), WAIT);
  }, 30_000);

  it('the choice from the gallery: "Vazgeç" goes back to the viewfinder; nothing is uploaded or recognised before it', async () => {
    await open('/item/add');
    await waitFor(() => expect(screen.getByTestId('item-add-gallery')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('item-add-gallery'));
    await waitFor(() => expect(screen.getByTestId('tryFirst.sheet')).toBeTruthy(), WAIT);
    expect(screen.getByText('What shall we do with this photo?')).toBeTruthy();
    expect(screen.getByText('Try it on me first')).toBeTruthy();
    expect(screen.getByText('Split into pieces')).toBeTruthy();
    // No recognition call before the user chooses.
    expect(fixtureListDrafts()).toHaveLength(0);
    expect(screen.queryByTestId('item-add-pill')).toBeNull();

    await fireEvent.press(screen.getByTestId('tryFirst.cancel'));
    await waitFor(() => expect(screen.getByTestId('item-add-frame-live')).toBeTruthy(), WAIT);
    expect(fixtureListDrafts()).toHaveLength(0);
  }, 30_000);

  it('a gallery pick highlights trying on first; "Parçalarına ayır" starts today\'s detection', async () => {
    await open('/item/add');
    await waitFor(() => expect(screen.getByTestId('item-add-gallery')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('item-add-gallery'));
    await waitFor(() => expect(screen.getByTestId('tryFirst.sheet')).toBeTruthy(), WAIT);
    expect(optionOrder()).toEqual(['tryFirst.tryOn', 'tryFirst.split']);
    await fireEvent.press(screen.getByTestId('tryFirst.split'));
    await waitFor(() => expect(fixtureListDrafts()).toHaveLength(1), WAIT);
    await waitFor(() => expect(screen).toHavePathname('/item/form'), WAIT);
  }, 30_000);

  it('afterwards: one tap, then the credit confirmation over the photo — no explainer, no upload yet', async () => {
    await AsyncStorage.setItem(photoExplainerKey('u1'), 'seen');
    await open('/item/add');
    await waitFor(() => expect(screen.getByTestId('item-add-gallery')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('item-add-gallery'));
    await waitFor(() => expect(screen.getByTestId('tryFirst.tryOn')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('tryFirst.tryOn'));
    await waitFor(() => expect(screen.getByText('1 credit will be used')).toBeTruthy(), WAIT);
    expect(screen.getByText('TRY IT ON ME · WHOLE OUTFIT')).toBeTruthy();
    expect(screen).toHavePathname('/item/add');
    expect(screen.getByTestId('item-add-frame-photo')).toBeTruthy();
    expect(fixtureListDrafts()).toHaveLength(0);
    // Stops before the AI step: the credit is not confirmed here.
  }, 30_000);
  it('the first "Önce üzerimde dene" opens the 16d explainer and remembers it for this user', async () => {
    await open('/item/add');
    await waitFor(() => expect(screen.getByTestId('item-add-gallery')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('item-add-gallery'));
    await waitFor(() => expect(screen.getByTestId('tryFirst.tryOn')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('tryFirst.tryOn'));
    await waitFor(() => expect(screen).toHavePathname('/tryon/photo'), WAIT);
    await waitFor(() => expect(screen.getByTestId('tryonPhoto.preview')).toBeTruthy(), WAIT);
    expect(screen.getByText("Let's show this outfit on you")).toBeTruthy();
    expect(await explainerFlag()).toBe('seen');
    // The explainer does not open the credit confirmation by itself.
    expect(screen.queryByText('1 credit will be used')).toBeNull();
    expect(fixtureListDrafts()).toHaveLength(0);
  }, 30_000);

});

describe('16d — explainer the first time, then the credit confirmation over the photo (16d′)', () => {
  it('first open: the explainer; the next open goes straight to the confirmation', async () => {
    await open('/tryon/photo?uri=file%3A%2F%2F%2Foutfit-0.jpg&w=1200&h=1600');
    await waitFor(() => expect(screen.getByTestId('tryonPhoto.preview')).toBeTruthy(), WAIT);
    expect(screen.queryByText('1 credit will be used')).toBeNull();
    expect(await explainerFlag()).toBe('seen');
  }, 30_000);

  it('seen: the photo with the confirmation opened over it, without the explainer copy', async () => {
    await AsyncStorage.setItem(photoExplainerKey('u1'), 'seen');
    await open('/tryon/photo?uri=file%3A%2F%2F%2Foutfit-0.jpg&w=1200&h=1600');
    await waitFor(() => expect(screen.getByTestId('tryonPhoto.direct')).toBeTruthy(), WAIT);
    await waitFor(() => expect(screen.getByText('1 credit will be used')).toBeTruthy(), WAIT);
    expect(screen.queryByText("Let's show this outfit on you")).toBeNull();
    expect(screen.getByText('SOURCE PHOTO')).toBeTruthy();
  }, 30_000);
});

describe('16g — the shared photo', () => {
  const shared = { uri: 'file:///cache/shared/s1.jpg', width: 1080, height: 1350, receivedAt: Date.now() };

  it('offers trying on first; "Parçalarına ayır" opens 12 with the photo and starts detection there', async () => {
    await sharedPhotoStore.capture(shared);
    await open('/share');
    await waitFor(() => expect(screen.getByTestId('share.landing')).toBeTruthy(), WAIT);
    expect(screen.getByText('Shared photo')).toBeTruthy();
    expect(screen.getByText('SHARED PHOTO')).toBeTruthy();
    expect(optionOrder()).toEqual(['tryFirst.tryOn', 'tryFirst.split']);
    await waitFor(() => expect(screen.getByTestId('tryFirst.split').props.accessibilityState?.disabled).toBeFalsy(), WAIT);
    await fireEvent.press(screen.getByTestId('tryFirst.split'));
    await waitFor(() => expect(fixtureListDrafts()).toHaveLength(1), WAIT);
    // Handled: it is not offered again.
    expect(sharedPhotoStore.get()).toBeNull();
  }, 30_000);

  it('"Önce üzerimde dene" the first time opens the 16d explainer with the shared photo', async () => {
    await sharedPhotoStore.capture(shared);
    await open('/share');
    await waitFor(() => expect(screen.getByTestId('share.landing')).toBeTruthy(), WAIT);
    await waitFor(() => expect(screen.getByTestId('tryFirst.tryOn').props.accessibilityState?.disabled).toBeFalsy(), WAIT);
    await fireEvent.press(screen.getByTestId('tryFirst.tryOn'));
    await waitFor(() => expect(screen).toHavePathname('/tryon/photo'), WAIT);
    await waitFor(() => expect(screen.getByTestId('tryonPhoto.preview')).toBeTruthy(), WAIT);
  }, 30_000);

  it('waits for the photo while it is being prepared', async () => {
    await open('/share');
    await waitFor(() => expect(screen.getByTestId('share.preparing')).toBeTruthy(), WAIT);
    await act(async () => sharedPhotoStore.capture(shared));
    await waitFor(() => expect(screen.getByTestId('share.landing')).toBeTruthy(), WAIT);
  }, 30_000);
});

describe('16e "Parçalara ayır" after trying first — the photo is not uploaded twice', () => {
  // The router tests above may leave fake timers installed; the fixtures' latency needs real ones.
  beforeEach(() => {
    jest.useRealTimers();
  });

  it('a local photo\'s try-on keeps its upload id for the result screen', async () => {
    const resolved = await resolvePhotoTryOn({ kind: 'local', uri: 'file:///a.jpg' });
    // Fixtures: the local uri stands in for the upload id.
    expect(resolved).toEqual({ target: { kind: 'photo', id: 'file:///a.jpg' }, uploadId: 'file:///a.jpg' });
    expect(photoTryOnParams('j1', resolved.target, { kind: 'local', uri: 'file:///a.jpg' }, 'up_9')).toMatchObject({ uploadId: 'up_9', ref: 'file:///a.jpg' });
    await expect(resolvePhotoTryOn({ kind: 'draft', draftId: 'd1' })).resolves.toEqual({ target: { kind: 'photo', id: 'd1' }, uploadId: null });
  });

  it('recognition starts on the existing upload: no upload-url, no second S3 POST', async () => {
    const previous = DATA_SOURCE.wardrobe;
    DATA_SOURCE.wardrobe = 'api';
    mockApi.mockReset();
    mockApi.mockImplementation(async (path: string) => {
      if (path === 'v1/tenant/item-draft') return { drafts: [{ id: 'up_9', kind: 'single' }], jobs: [{ id: 'job1' }], skippedCount: 0 };
      return {};
    });
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    try {
      const { result } = await renderHook(() => useStartItemDrafts(), { wrapper });
      let response: { draftIds: string[] } | undefined;
      await act(async () => {
        response = await result.current.startFromUpload('up_9', 'file:///a.jpg');
      });
      expect(response?.draftIds).toEqual(['up_9']);
      const paths = mockApi.mock.calls.map((c) => c[0]);
      expect(paths).not.toContain('v1/tenant/item/upload-url');
      expect(mockApi).toHaveBeenCalledWith('v1/tenant/item-draft', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ uploadIds: ['up_9'], manual: false }) }));
    } finally {
      DATA_SOURCE.wardrobe = previous;
    }
  });
});
