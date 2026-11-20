import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import '@/i18n';

import { ImageSlot, asGarmentCategory, asGarmentColor, initialsOf, toneFromSeed, TONE_BY_COLOR } from './ImageSlot';
import { PlaceholderImage } from './PlaceholderImage';

describe('ImageSlot — a missing image is never an empty box', () => {
  it('draws the category glyph on a ground tinted from the colour for a garment without a picture', async () => {
    await render(<ImageSlot placeholder={{ kind: 'garment', category: 'dress', color: 'black' }} accessibilityLabel="Siyah elbise" />);
    expect(screen.getByTestId('image-slot-garment')).toBeTruthy();
    expect(screen.getByLabelText('Siyah elbise')).toBeTruthy();
    expect(TONE_BY_COLOR.black).toBe('dark');
  });

  it('composes a collage of the pieces for a look without a rendered image, marking missing pieces', async () => {
    await render(
      <ImageSlot
        placeholder={{
          kind: 'look',
          pieces: [
            { category: 'dress', color: 'navy' },
            { category: 'outerwear', color: 'brown' },
            { category: 'shoes', color: 'beige' },
            { category: 'bag', color: 'black', missing: true },
          ],
        }}
      />,
    );
    expect(screen.getByTestId('image-slot-collage')).toBeTruthy();
    expect(screen.getAllByTestId('image-slot-garment')).toHaveLength(4);
    expect(screen.getByText('MISSING')).toBeTruthy();
  });

  it('falls back to the standing figure when a look has no pieces, and by default', async () => {
    await render(<ImageSlot placeholder={{ kind: 'look', pieces: [], seed: 'look-1', figureHeight: 130 }} />);
    expect(screen.getByTestId('image-slot-figure')).toBeTruthy();
    await render(<PlaceholderImage />);
    expect(screen.getAllByTestId('image-slot-figure').length).toBeGreaterThan(0);
  });

  it('shows initials for a person without a photo', async () => {
    await render(<ImageSlot placeholder={{ kind: 'avatar', name: 'Selin Yıldız' }} />);
    expect(screen.getByText('SY')).toBeTruthy();
    expect(initialsOf('@ornek_stilist')).toBe('OS');
    expect(initialsOf('ilkay')).toBe('İ');
    expect(initialsOf(null)).toBe('');
  });

  it('loads a real image with a skeleton first and returns to the placeholder when loading fails', async () => {
    await render(<ImageSlot testID="slot" uri="https://example.com/a.jpg" placeholder={{ kind: 'garment', category: 'bag' }} />);
    expect(screen.getByTestId('image-slot-loading')).toBeTruthy();
    expect(screen.queryByTestId('image-slot-garment')).toBeNull();
    const image = screen.getByTestId('image-slot-image');
    await fireEvent(image, 'load', { nativeEvent: {} });
    expect(screen.queryByTestId('image-slot-loading')).toBeNull();
    await fireEvent(image, 'error', { nativeEvent: {} });
    expect(screen.getByTestId('image-slot-garment')).toBeTruthy();
  });

  it('narrows free-form catalogue values and keeps a stable tone per id', () => {
    expect(asGarmentCategory('shoes')).toBe('shoes');
    expect(asGarmentCategory('unknown')).toBe('top');
    expect(asGarmentColor(null)).toBe('other');
    expect(toneFromSeed('look-7')).toBe(toneFromSeed('look-7'));
    expect(toneFromSeed(undefined)).toBe('stage');
  });
});

/** expo-image normalises `source` to an array in the test renderer. */
function sourceOf(): { uri: string; cacheKey?: string } | undefined {
  const source = screen.getByTestId('image-slot-image').props.source as { uri: string; cacheKey?: string } | { uri: string; cacheKey?: string }[];
  return Array.isArray(source) ? source[0] : source;
}

describe('ImageSlot — stable cache key and refresh-once on an expired URL', () => {
  it('loads through the cache key (also the recycling key) instead of the URL', async () => {
    await render(<ImageSlot uri="https://s3/a.webp?sig=1" cacheKey="item:1:v2:256" />);
    expect(sourceOf()).toMatchObject({ uri: 'https://s3/a.webp?sig=1', cacheKey: 'item:1:v2:256' });
    expect(screen.getByTestId('image-slot-image').props.recyclingKey).toBe('item:1:v2:256');
  });

  it('a failed load asks for a fresh URL once and loads it with the same key; a second failure keeps the placeholder', async () => {
    const onExpired = jest.fn().mockResolvedValueOnce('https://s3/tryon.webp?sig=2');
    await render(<ImageSlot uri="https://s3/tryon.webp?sig=1" cacheKey="tryon:img1" onExpired={onExpired} placeholder={{ kind: 'garment', category: 'top' }} />);
    await fireEvent(screen.getByTestId('image-slot-image'), 'error', { nativeEvent: { error: 'expired' } });
    await waitFor(() => expect(sourceOf()).toMatchObject({ uri: 'https://s3/tryon.webp?sig=2', cacheKey: 'tryon:img1' }));
    expect(onExpired).toHaveBeenCalledTimes(1);

    await fireEvent(screen.getByTestId('image-slot-image'), 'error', { nativeEvent: { error: 'gone' } });
    expect(screen.getByTestId('image-slot-garment')).toBeTruthy();
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('a refresh that re-fetches the owning query: the new URL from the props loads, and only once per mount', async () => {
    const onExpired = jest.fn().mockResolvedValue(undefined);
    const view = await render(<ImageSlot uri="https://s3/i.webp?sig=1" cacheKey="item:1:v2:256" onExpired={onExpired} placeholder={{ kind: 'garment', category: 'top' }} />);
    await fireEvent(screen.getByTestId('image-slot-image'), 'error', { nativeEvent: {} });
    // Placeholder until the query answers.
    expect(screen.getByTestId('image-slot-garment')).toBeTruthy();
    await waitFor(() => expect(onExpired).toHaveBeenCalledTimes(1));

    await view.rerender(<ImageSlot uri="https://s3/i.webp?sig=2" cacheKey="item:1:v2:256" onExpired={onExpired} placeholder={{ kind: 'garment', category: 'top' }} />);
    expect(sourceOf()).toMatchObject({ uri: 'https://s3/i.webp?sig=2', cacheKey: 'item:1:v2:256' });
    await fireEvent(screen.getByTestId('image-slot-image'), 'error', { nativeEvent: {} });
    expect(screen.getByTestId('image-slot-garment')).toBeTruthy();
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('a refresh that fails keeps the placeholder', async () => {
    const onExpired = jest.fn().mockRejectedValue(new Error('offline'));
    await render(<ImageSlot uri="https://s3/p.jpg" cacheKey="photo:p1" onExpired={onExpired} placeholder={{ kind: 'garment', category: 'top' }} />);
    await fireEvent(screen.getByTestId('image-slot-image'), 'error', { nativeEvent: {} });
    await waitFor(() => expect(onExpired).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('image-slot-garment')).toBeTruthy();
  });
});
