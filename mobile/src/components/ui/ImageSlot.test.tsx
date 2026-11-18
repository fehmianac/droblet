import { fireEvent, render, screen } from '@testing-library/react-native';

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
