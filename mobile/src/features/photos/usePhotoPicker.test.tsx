import { renderHook, waitFor } from '@testing-library/react-native';

import { SHEET_SETTLE_MS, usePhotoPicker } from './usePhotoPicker';

const mockLaunchLibrary = jest.fn(async () => ({ canceled: true, assets: null }));
const mockLaunchCamera = jest.fn(async () => ({ canceled: true, assets: null }));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: () => mockLaunchLibrary(),
  launchCameraAsync: () => mockLaunchCamera(),
  getCameraPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
  requestCameraPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
  getMediaLibraryPermissionsAsync: async () => ({ granted: true }),
}));

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

beforeEach(() => {
  mockLaunchLibrary.mockClear();
  mockLaunchCamera.mockClear();
});

// "Galeriden seç" did nothing on iOS: the picker was launched while the photo-source sheet was still fading out, and
// iOS drops a presentation over a dismissing Modal. Every launch now waits for the sheet to settle first.
describe('usePhotoPicker waits for the closing sheet before presenting', () => {
  it('uses a settle delay on iOS', () => {
    expect(SHEET_SETTLE_MS).toBeGreaterThanOrEqual(400);
  });

  it('opens the library only after the sheet has settled', async () => {
    const { result } = await renderHook(() => usePhotoPicker({ onPicked: jest.fn(), onError: jest.fn() }));
    const started = Date.now();
    result.current.chooseFromLibrary(3);
    expect(mockLaunchLibrary).not.toHaveBeenCalled();
    await waitFor(() => expect(mockLaunchLibrary).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(SHEET_SETTLE_MS - 20);
  });

  it('opens the camera only after the sheet has settled', async () => {
    const { result } = await renderHook(() => usePhotoPicker({ onPicked: jest.fn(), onError: jest.fn() }));
    result.current.takePhoto();
    await new Promise((r) => setTimeout(r, 50));
    expect(mockLaunchCamera).not.toHaveBeenCalled();
    await waitFor(() => expect(mockLaunchCamera).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });
});
