import { render, screen } from '@testing-library/react-native';

import type { LookSlot } from '@/api/contracts/looks';
import type { Item } from '@/api/contracts/wardrobe';
import i18n from '@/i18n';

import { indexItems, LookCover } from './LookCover';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

const slot = (kind: LookSlot['slot'], refId: string, extra: Partial<LookSlot> = {}): LookSlot => ({
  slot: kind,
  source: 'wardrobe',
  refId,
  name: refId,
  imageUrl: null,
  brand: null,
  price: null,
  deleted: false,
  ...extra,
});

describe('LookCover — flat-lay (21c)', () => {
  const slots = [slot('top', 'i1'), slot('bottom', 'i2'), slot('shoes', 'i3'), slot('accessory', 'p1', { source: 'store' })];

  it('a full-size cover without a rendered image lays the pieces out flat, the item category winning over the slot', async () => {
    // The bottom slot holds a dress: it lies tall on the left only when there is no top, so here it takes the right frame.
    const items = indexItems([{ id: 'i2', category: 'dress', color: 'black' } as Item]);
    await render(<LookCover seed="look-1" slots={slots} itemsById={items} className="h-[210px] w-full" accessibilityLabel="Office, Blazer" />);
    expect(screen.getByTestId('image-slot-flatlay')).toBeTruthy();
    expect(screen.getByTestId('flatlay-upper')).toBeTruthy();
    expect(screen.getByTestId('flatlay-dress')).toBeTruthy();
    expect(screen.queryByTestId('flatlay-lower')).toBeNull();
    expect(screen.getByTestId('flatlay-accessory')).toBeTruthy();
    // The store piece keeps its "missing" marker.
    expect(screen.getByText('MISSING')).toBeTruthy();
    expect(screen.getByLabelText('Office, Blazer')).toBeTruthy();
  });

  it('a generated cover stays the cover', async () => {
    await render(<LookCover seed="look-1" tryOnImageUrl="https://s3/tryon.webp" slots={slots} itemsById={new Map()} />);
    expect(screen.getByTestId('image-slot-image')).toBeTruthy();
    expect(screen.queryByTestId('image-slot-flatlay')).toBeNull();
  });

  it('a thumbnail keeps its collage of photographs (or the figure)', async () => {
    await render(<LookCover seed="look-1" figureHeight={46} slots={slots} itemsById={new Map()} />);
    expect(screen.queryByTestId('image-slot-flatlay')).toBeNull();
    expect(screen.getByTestId('image-slot-figure')).toBeTruthy();
  });
});
