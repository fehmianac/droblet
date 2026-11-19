import { render, screen } from '@testing-library/react-native';

import { ImageSlot } from './ImageSlot';
import { AiImage } from './AiBadge';

import '@/i18n';

describe('ImageSlot fit', () => {
  it('fills the slot by default', async () => {
    await render(<ImageSlot uri="https://example.com/a.webp" className="h-10 w-10" />);
    expect(screen.getByTestId('image-slot-image').props.contentFit).toBe('cover');
  });

  it('shows a generated "on you" image whole (contain), so the head and feet are never cut', async () => {
    await render(<AiImage kind="onYou" uri="https://example.com/tryon.webp" className="aspect-[4/5] w-full" />);
    expect(screen.getByTestId('image-slot-image').props.contentFit).toBe('contain');
  });
});
