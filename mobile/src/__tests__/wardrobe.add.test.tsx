import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { fixtureDb, resetFixtureDb } from '@/fixtures/db';
import { fixtureDraftOptions, fixtureListDrafts, resetFixtureDrafts, setFixtureItemRecognition } from '@/fixtures/wardrobe';

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

// The in-app camera (`jest/expoCameraMock.js`): the test decides the permission and what the shutter returns.
type MockPermission = { granted: boolean; canAskAgain: boolean } | null;
const mockCamera = jest.requireMock<{ __camera: { permission: MockPermission; request: jest.Mock; take: jest.Mock } }>('expo-camera').__camera;

// Downscaling / EXIF stripping needs the native image module: the shot is handed on as it is.
jest.mock('@/features/photos/preparePhoto', () => ({
  preparePhoto: jest.fn(async (uri: string, width: number, height: number) => ({ uploadId: 'up_shot', localUri: uri, width, height })),
  deleteLocalPhoto: jest.fn(),
}));
const mockPicker = { takePhoto: jest.fn(), chooseFromLibrary: jest.fn() };
jest.mock('@/features/photos/usePhotoPicker', () => ({
  usePhotoPicker: () => ({ takePhoto: mockPicker.takePhoto, chooseFromLibrary: mockPicker.chooseFromLibrary, sheet: null }),
}));

const WAIT = { timeout: 6000 };
/** Lets the entitlement (fixture latency) settle so the screen knows the quota. */
const settle = () => waitFor(() => new Promise<void>((resolve) => setTimeout(resolve, 700)), { timeout: 2000 });

async function open(initialUrl: string) {
  await AsyncStorage.removeItem('droblet.query.u1');
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
  await renderRouter('./src/app', { initialUrl });
}

beforeEach(() => {
  resetFixtureDb();
  resetFixtureDrafts();
  fixtureDraftOptions.baseMs = 0;
  mockCamera.permission = { granted: true, canAskAgain: true };
  mockCamera.request.mockClear();
  mockCamera.take.mockReset();
  mockCamera.take.mockImplementation(async () => ({ uri: 'file:///shot.jpg', width: 1200, height: 1600 }));
  mockPicker.takePhoto.mockClear();
  mockPicker.chooseFromLibrary.mockClear();
});

describe('12 Parça ekle — in-app camera', () => {
  it('draws the live viewfinder with the shutter and the gallery / library / bulk shortcuts', async () => {
    await open('/item/add');
    await waitFor(() => expect(screen.getByTestId('item-add-camera')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('item-add-frame-live')).toBeTruthy();
    expect(screen.getByText('Add a piece')).toBeTruthy();
    expect(screen.getByLabelText('Take a photo')).toBeTruthy();
    expect(screen.getByText('Gallery')).toBeTruthy();
    expect(screen.getByText('Ready-made library')).toBeTruthy();
    expect(screen.getByLabelText('Bulk add')).toBeTruthy();
    expect(screen.getByText('Lay the piece on a flat surface or shoot it on a hanger')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('item-add-library'));
    await waitFor(() => expect(screen).toHavePathname('/item/library'), WAIT);
  }, 20_000);

  it('the shutter takes the picture in the app, says what was detected and opens the review form', async () => {
    await open('/item/add');
    await waitFor(() => expect(screen.getByTestId('item-add-camera')).toBeTruthy(), WAIT);
    await settle();
    await fireEvent.press(screen.getByTestId('item-add-shutter'));
    await waitFor(() => expect(mockCamera.take).toHaveBeenCalledTimes(1), WAIT);
    // The system camera is not used when the viewfinder is live.
    expect(mockPicker.takePhoto).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('item-add-pill').props.accessibilityLabel).toMatch(/detected · /), WAIT);
    expect(screen.getByTestId('item-add-frame-photo')).toBeTruthy();
    await waitFor(() => expect(screen).toHavePathname('/item/form'), WAIT);
    await waitFor(() => expect(screen.getByText('AI GUESS · PLEASE CHECK')).toBeTruthy(), WAIT);
    expect(fixtureListDrafts()).toHaveLength(1);
  }, 30_000);

  it('permission not asked yet: explains why in the frame and asks on "Turn on camera"', async () => {
    mockCamera.permission = { granted: false, canAskAgain: true };
    await open('/item/add');
    await waitFor(() => expect(screen.getByTestId('item-add-frame-ask')).toBeTruthy(), WAIT);
    expect(screen.getByText(/We need the camera so you can photograph your piece/)).toBeTruthy();
    expect(screen.queryByTestId('item-add-camera')).toBeNull();
    await fireEvent.press(screen.getByTestId('item-add-allow-camera'));
    expect(mockCamera.request).toHaveBeenCalledTimes(1);
    // The shutter asks too, instead of failing silently.
    await fireEvent.press(screen.getByTestId('item-add-shutter'));
    expect(mockCamera.request).toHaveBeenCalledTimes(2);
  }, 20_000);

  it('permission denied: explains, links to Settings, and gallery / library / manual entry still work', async () => {
    mockCamera.permission = { granted: false, canAskAgain: false };
    await open('/item/add');
    await waitFor(() => expect(screen.getByTestId('item-add-frame-denied')).toBeTruthy(), WAIT);
    expect(screen.getByText(/Camera access is off/)).toBeTruthy();
    expect(screen.getByText('Open Settings')).toBeTruthy();
    await settle();
    await fireEvent.press(screen.getByTestId('item-add-gallery'));
    expect(mockPicker.chooseFromLibrary).toHaveBeenCalledWith(1);
    // The shutter falls back to the system picker, which explains the denial and offers the gallery.
    await fireEvent.press(screen.getByTestId('item-add-shutter'));
    expect(mockPicker.takePhoto).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('item-add-library')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('item-add-manual'));
    await waitFor(() => expect(screen).toHavePathname('/item/form'), WAIT);
  }, 20_000);

  it('no usable camera (simulator): a failed shot is reported and the shutter then uses the system picker', async () => {
    mockCamera.take.mockRejectedValueOnce(new Error('no camera device'));
    await open('/item/add');
    await waitFor(() => expect(screen.getByTestId('item-add-camera')).toBeTruthy(), WAIT);
    await settle();
    await fireEvent.press(screen.getByTestId('item-add-shutter'));
    await waitFor(() => expect(screen.getByText("The photo couldn't be prepared. Try another one.")).toBeTruthy(), WAIT);
    expect(screen.getByTestId('item-add-frame-unavailable')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('item-add-shutter'));
    expect(mockPicker.takePhoto).toHaveBeenCalledTimes(1);
  }, 20_000);
});

describe('12 → 12c: the photo survives an exhausted recognition quota', () => {
  it('a photo taken before a 402 item_recognition_limit_reached is carried into the manual form and saved with the piece', async () => {
    setFixtureItemRecognition(3, 2);
    await open('/item/add');
    await waitFor(() => expect(screen.getByTestId('item-add-camera')).toBeTruthy(), WAIT);
    await settle();
    // The last free recognition is used elsewhere: the app still believes one is left, the server says 402.
    setFixtureItemRecognition(3, 3);
    await fireEvent.press(screen.getByTestId('item-add-shutter'));
    await waitFor(() => expect(screen).toHavePathname('/paywall'), WAIT);
    expect(fixtureListDrafts()).toHaveLength(0);

    // Back from the paywall: the shot is still in the frame and "Enter manually" says it will be kept.
    await act(async () => router.back());
    await waitFor(() => expect(screen.getByText(/the photo you took is saved with the piece/)).toBeTruthy(), WAIT);
    expect(screen.getByTestId('item-add-frame-photo')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('item-add-manual'));
    await waitFor(() => expect(screen).toHavePathname('/item/form'), WAIT);
    await waitFor(() => expect(screen.getByText(/Your photo is ready/)).toBeTruthy(), WAIT);
    expect(screen.getByLabelText('Photo of the piece, original')).toBeTruthy();
    expect(screen.getByText('ORIGINAL')).toBeTruthy();

    // Fill in the required fields by hand and save: the piece enters the wardrobe with the photo.
    const before = fixtureDb.items.length;
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Keten gömlek');
    await fireEvent.press(screen.getByLabelText(/^Category/));
    await fireEvent.press(await screen.findByText('Tops'));
    await fireEvent.press(screen.getByText('OK'));
    await fireEvent.press(screen.getByLabelText(/^Colour|^Color/));
    await fireEvent.press(await screen.findByLabelText('White'));
    await fireEvent.press(screen.getByText('Summer'));
    await fireEvent.press(screen.getByTestId('item-form-save'));
    await waitFor(() => expect(fixtureDb.items).toHaveLength(before + 1), WAIT);
    expect(fixtureDb.items[0]).toMatchObject({
      name: 'Keten gömlek',
      category: 'top',
      color: 'white',
      imageUrl: 'file:///shot.jpg',
      originalImageUrl: 'file:///shot.jpg',
      useOriginalImage: true,
    });
  }, 40_000);

  it('with the quota already known to be used up the shot is still taken, the paywall opens and the photo is kept', async () => {
    setFixtureItemRecognition(3, 3);
    await open('/item/add');
    await waitFor(() => expect(screen.getByTestId('item-add-camera')).toBeTruthy(), WAIT);
    await settle();
    await fireEvent.press(screen.getByTestId('item-add-shutter'));
    await waitFor(() => expect(screen).toHavePathname('/paywall'), WAIT);
    expect(mockCamera.take).toHaveBeenCalledTimes(1);
    expect(fixtureListDrafts()).toHaveLength(0);
    await act(async () => router.back());
    await waitFor(() => expect(screen.getByTestId('item-add-frame-photo')).toBeTruthy(), WAIT);
    // "Retake" goes back to the viewfinder and drops the photo.
    await fireEvent.press(screen.getByTestId('item-add-retake'));
    await waitFor(() => expect(screen.getByTestId('item-add-frame-live')).toBeTruthy(), WAIT);
  }, 30_000);
});
