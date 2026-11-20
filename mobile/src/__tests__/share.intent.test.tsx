import '@/i18n';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';

import { ShareIntentHost } from '@/features/share/ShareIntentHost';
import { sharedPhotoStore } from '@/features/share/sharedPhoto';

/** What expo-share-intent's hook answers: the test changes it between renders (cold start = there at mount). */
type MockFile = { path: string | null; mimeType: string; width?: number; height?: number };
const mockIntent: { has: boolean; files: MockFile[] | null; reset: jest.Mock } = { has: false, files: null, reset: jest.fn() };
jest.mock('expo-share-intent', () => ({
  useShareIntent: () => ({
    isReady: true,
    hasShareIntent: mockIntent.has,
    shareIntent: { files: mockIntent.files, text: null, webUrl: null, type: mockIntent.files ? 'media' : null },
    resetShareIntent: mockIntent.reset,
    error: null,
  }),
}));

const mockRouter = { push: jest.fn(), pathname: '/' };
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockRouter.push(...args) },
  usePathname: () => mockRouter.pathname,
}));

jest.mock('@/features/photos/preparePhoto', () => ({
  preparePhoto: jest.fn(async (uri: string, width: number, height: number) => ({
    uploadId: 'p1',
    localUri: uri.replace('group', 'cache/shared'),
    width: width || 1000,
    height: height || 1250,
  })),
}));
const preparePhoto = jest.requireMock<{ preparePhoto: jest.Mock }>('@/features/photos/preparePhoto').preparePhoto;

jest.mock('@/components/ui/toast/store', () => ({ showToast: jest.fn() }));
const showToast = jest.requireMock<{ showToast: jest.Mock }>('@/components/ui/toast/store').showToast;

const IMAGE: MockFile = { path: 'file:///group/shared-1.jpg', mimeType: 'image/jpeg', width: 1080, height: 1350 };

function deliver(files: MockFile[]) {
  mockIntent.has = true;
  mockIntent.files = files;
  // The native side is cleared after the image is kept, as the real hook does.
  mockIntent.reset.mockImplementation(() => {
    mockIntent.has = false;
    mockIntent.files = null;
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  sharedPhotoStore.reset();
  mockIntent.has = false;
  mockIntent.files = null;
  mockIntent.reset.mockReset();
  mockRouter.push.mockReset();
  mockRouter.pathname = '/';
  preparePhoto.mockClear();
  showToast.mockClear();
});

describe('Share › Droblet — receiving the image', () => {
  it('cold start: the shared image is prepared into the cache, the native share is cleared and 16g opens', async () => {
    deliver([IMAGE]);
    await render(<ShareIntentHost signedIn ready />);
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/share'));
    expect(preparePhoto).toHaveBeenCalledWith('file:///group/shared-1.jpg', 1080, 1350, 2048, 'cache');
    expect(sharedPhotoStore.get()).toMatchObject({ uri: 'file:///cache/shared/shared-1.jpg', width: 1080, height: 1350 });
    expect(mockIntent.reset).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
  });

  it('warm start: a share arriving while the app runs opens 16g; nothing happens before it', async () => {
    const view = await render(<ShareIntentHost signedIn ready />);
    await act(async () => undefined);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(preparePhoto).not.toHaveBeenCalled();

    deliver([{ path: 'file:///group/a.mov', mimeType: 'video/quicktime' }, IMAGE]);
    await view.rerender(<ShareIntentHost signedIn ready />);
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/share'));
    // Several items: the first image is used.
    expect(preparePhoto).toHaveBeenCalledTimes(1);
    expect(preparePhoto.mock.calls[0][0]).toBe('file:///group/shared-1.jpg');
  });

  it('16g already open (the iOS link routed there): the photo appears without a second push', async () => {
    mockRouter.pathname = '/share';
    deliver([IMAGE]);
    await render(<ShareIntentHost signedIn ready />);
    await waitFor(() => expect(sharedPhotoStore.get()).not.toBeNull());
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('signed out: the photo waits on the device ("Fotoğrafın hazır"); after sign-in and onboarding 16g opens', async () => {
    deliver([IMAGE]);
    const view = await render(<ShareIntentHost signedIn={false} ready={false} />);
    await waitFor(() => expect(sharedPhotoStore.get()).not.toBeNull());
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith({ message: expect.stringMatching(/Your photo is ready/) });
    await expect(AsyncStorage.getItem('droblet.sharedPhoto')).resolves.toContain('shared-1.jpg');

    // Signed in, onboarding not finished yet: still waiting.
    await view.rerender(<ShareIntentHost signedIn ready={false} />);
    await act(async () => undefined);
    expect(mockRouter.push).not.toHaveBeenCalled();

    await view.rerender(<ShareIntentHost signedIn ready />);
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/share'));
  });

  it('signed out and the app restarted by the sign-in: the stored photo still opens 16g', async () => {
    await sharedPhotoStore.capture({ uri: 'file:///cache/shared/old.jpg', width: 900, height: 1200, receivedAt: Date.now() });
    sharedPhotoStore.reset();
    await render(<ShareIntentHost signedIn ready />);
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/share'));
    expect(sharedPhotoStore.get()?.uri).toBe('file:///cache/shared/old.jpg');
  });

  it('a share without an image says so and keeps nothing', async () => {
    deliver([{ path: 'file:///group/clip.mp4', mimeType: 'video/mp4' }]);
    await render(<ShareIntentHost signedIn ready />);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ message: 'You can only share photos to Droblet.', tone: 'error' }));
    expect(sharedPhotoStore.get()).toBeNull();
    expect(mockIntent.reset).toHaveBeenCalled();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });
});
