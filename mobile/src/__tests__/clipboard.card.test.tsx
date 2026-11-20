import '@/i18n';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ClipboardPhotoCard } from '@/features/tryon/ClipboardPhotoCard';
import { clipboardCardDismissal } from '@/features/tryon/clipboardPhoto';

jest.mock('expo-clipboard', () => ({
  hasImageAsync: jest.fn(async () => false),
  getImageAsync: jest.fn(async () => ({ data: 'data:image/jpeg;base64,AAAA', size: { width: 900, height: 1200 } })),
}));
const clipboard = jest.requireMock<{ hasImageAsync: jest.Mock; getImageAsync: jest.Mock }>('expo-clipboard');

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  // The hub tab is focused for the whole test.
  useFocusEffect: (effect: () => void | (() => void)) => {
    jest.requireActual<typeof import('react')>('react').useEffect(effect, []);
  },
}));

const mockWritten: string[] = [];
jest.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    create() {}
  }
  class File {
    uri: string;
    exists = true;
    constructor(dir: { uri: string }, name: string) {
      this.uri = `${dir.uri}/${name}`;
    }
    write(content: string) {
      mockWritten.push(content);
    }
    delete() {
      this.exists = false;
    }
  }
  return { Directory, File, Paths: { cache: { uri: 'file:///cache' } } };
});

jest.mock('@/features/photos/preparePhoto', () => ({
  preparePhoto: jest.fn(async (_uri: string, width: number, height: number) => ({ uploadId: 'c1', localUri: 'file:///cache/shared/prepared.jpg', width, height })),
}));
const preparePhoto = jest.requireMock<{ preparePhoto: jest.Mock }>('@/features/photos/preparePhoto').preparePhoto;

jest.mock('@/components/ui/toast/store', () => ({ showToast: jest.fn() }));

beforeEach(() => {
  clipboard.hasImageAsync.mockReset();
  clipboard.getImageAsync.mockClear();
  mockPush.mockReset();
  preparePhoto.mockClear();
  mockWritten.length = 0;
  clipboardCardDismissal.reset();
});

describe('16c+ "Kopyaladığın fotoğrafı üzerimde dene"', () => {
  it('is not shown when the clipboard holds no image', async () => {
    clipboard.hasImageAsync.mockResolvedValue(false);
    await render(<ClipboardPhotoCard />);
    await act(async () => undefined);
    expect(clipboard.hasImageAsync).toHaveBeenCalled();
    expect(screen.queryByTestId('stylist.clipboardPhoto')).toBeNull();
    expect(clipboard.getImageAsync).not.toHaveBeenCalled();
  });

  it('shows only that an image is there — the clipboard is not read until the card is tapped', async () => {
    clipboard.hasImageAsync.mockResolvedValue(true);
    await render(<ClipboardPhotoCard />);
    await waitFor(() => expect(screen.getByTestId('stylist.clipboardPhoto')).toBeTruthy());
    expect(screen.getByText('Try the photo you copied on me')).toBeTruthy();
    expect(screen.getByText('Read from the clipboard when you tap · 1 credit')).toBeTruthy();
    // No read (no iOS paste banner) just because the card is on screen.
    expect(clipboard.getImageAsync).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('stylist.clipboardPhoto.open'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(clipboard.getImageAsync).toHaveBeenCalledTimes(1);
    // Written to the cache, prepared like every picked photo, then 16d.
    expect(mockWritten).toEqual(['AAAA']);
    expect(preparePhoto).toHaveBeenCalledWith(expect.stringMatching(/^file:\/\/\/cache\/shared\/clipboard-.*\.jpg$/), 900, 1200, undefined, 'cache');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/tryon/photo', params: { uri: 'file:///cache/shared/prepared.jpg', w: '900', h: '1200' } });
  });

  it('"×" hides it for this session without reading the clipboard', async () => {
    clipboard.hasImageAsync.mockResolvedValue(true);
    await render(<ClipboardPhotoCard />);
    await waitFor(() => expect(screen.getByTestId('stylist.clipboardPhoto')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('stylist.clipboardPhoto.dismiss'));
    expect(screen.queryByTestId('stylist.clipboardPhoto')).toBeNull();
    expect(clipboard.getImageAsync).not.toHaveBeenCalled();
  });
});
