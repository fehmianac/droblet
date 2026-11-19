import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import i18n from '@/i18n';

import { TryOnResultImage } from './TryOnResultImage';

const mockRequest = jest.fn();
jest.mock('@/api/wire/tryon', () => ({ requestTryOnImage: (id: string) => mockRequest(id) }));

/** expo-image normalises `source` to an array in the test renderer. */
function uriOf(): string | undefined {
  const source = screen.getByTestId('image-slot-image').props.source as { uri: string } | { uri: string }[];
  return Array.isArray(source) ? source[0]?.uri : source.uri;
}

beforeEach(async () => {
  mockRequest.mockReset();
  await i18n.changeLanguage('en');
});

describe('TryOnResultImage', () => {
  it('loads the URL; a failed load fetches a fresh presigned URL once, then shows the error with retry', async () => {
    mockRequest.mockResolvedValueOnce({ imageUrl: 'https://s3.test/fresh.webp' });
    await render(<TryOnResultImage tryOnId="img1" url="https://s3.test/old.webp" accessibilityLabel="On you" />);
    expect(uriOf()).toBe('https://s3.test/old.webp');

    await fireEvent(screen.getByTestId('image-slot-image'), 'error', { nativeEvent: { error: 'expired' } });
    await waitFor(() => expect(uriOf()).toBe('https://s3.test/fresh.webp'));
    expect(mockRequest).toHaveBeenCalledWith('img1');

    // The fresh URL fails too: the error state, and "Try again" asks once more.
    await fireEvent(screen.getByTestId('image-slot-image'), 'error', { nativeEvent: { error: 'expired' } });
    await waitFor(() => expect(screen.getByTestId('tryon.imageFailed')).toBeTruthy());
    expect(screen.getByText('The image could not be loaded. Check your connection and try again.')).toBeTruthy();
    mockRequest.mockResolvedValueOnce({ imageUrl: 'https://s3.test/third.webp' });
    await fireEvent.press(screen.getByTestId('tryon.imageRetry'));
    await waitFor(() => expect(uriOf()).toBe('https://s3.test/third.webp'));
  });

  it('shows the skeleton until the image has loaded', async () => {
    await render(<TryOnResultImage tryOnId="img1" url="https://s3.test/a.webp" accessibilityLabel="On you" />);
    expect(screen.getByTestId('image-slot-loading')).toBeTruthy();
    await fireEvent(screen.getByTestId('image-slot-image'), 'load', { nativeEvent: { source: { url: 'x', width: 1, height: 1 } } });
    expect(screen.queryByTestId('image-slot-loading')).toBeNull();
  });
});
