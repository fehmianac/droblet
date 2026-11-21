import { fireEvent, render, screen } from '@testing-library/react-native';

import { toLibraryItem } from '@/api/today';
import { AiImage } from '@/components/ui/AiBadge';
import { asGarmentCategory, asGarmentColor } from '@/components/ui/ImageSlot';
import { LookCard } from '@/components/ui/LookCard';
import { ProductCard } from '@/components/ui/ProductCard';
import { ProductRow } from '@/components/ui/ProductRow';
import { Avatar } from '@/components/blocks/basics';
import { coverPieces } from '@/features/looks/LookCover';
import { OnYouImage } from '@/features/today/OnYouImage';
import i18n from '@/i18n';

import { TryOnInvite, tryOnInviteKind } from './TryOnInvite';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('"on you" areas without a generated image', () => {
  it('AiImage marks only a real image', async () => {
    await render(<AiImage kind="onYou" uri={null} className="h-40 w-32" placeholder={{ kind: 'look', pieces: [{ category: 'dress', color: 'black' }] }} />);
    expect(screen.queryByText('ON YOU')).toBeNull();
    expect(screen.getByTestId('image-slot-collage')).toBeTruthy();
    await render(<AiImage kind="onYou" uri="https://example.com/a.jpg" className="h-40 w-32" />);
    expect(screen.getByText('ON YOU')).toBeTruthy();
  });

  it('OnYouImage: the AI tag only on a real image, the collage badge otherwise — and nothing laid over it', async () => {
    await render(<OnYouImage uri={null} pieces={[{ category: 'top', color: 'white' }, { category: 'bag', color: 'black', missing: true }]} silhouetteHeight={168} collageLabel="Look, piece collage" />);
    expect(screen.queryByTestId('on-you-tag')).toBeNull();
    expect(screen.getByText('Piece collage')).toBeTruthy();
    expect(screen.getByLabelText('Look, piece collage')).toBeTruthy();
    expect(screen.getAllByTestId('image-slot-garment')).toHaveLength(2);
    expect(screen.queryByRole('button')).toBeNull();

    await render(<OnYouImage uri="https://example.com/a.jpg" pieces={[]} silhouetteHeight={168} accessibilityLabel="Look on you" />);
    expect(screen.getByTestId('on-you-tag')).toBeTruthy();
    expect(screen.getByLabelText('Look on you')).toBeTruthy();
  });

  it('the invitation names what a tap does: a missing photo first, then membership, else the try-on (consent / credits open the flow)', () => {
    expect(tryOnInviteKind({ ready: false, hint: 'bodyPhoto' })).toBe('photo');
    expect(tryOnInviteKind({ ready: false, hint: 'facePhoto' })).toBe('photo');
    expect(tryOnInviteKind({ ready: false, hint: 'bodyType' })).toBe('photo');
    expect(tryOnInviteKind({ ready: false, hint: 'premium' })).toBe('member');
    expect(tryOnInviteKind({ ready: false, hint: 'consent' })).toBe('ready');
    expect(tryOnInviteKind({ ready: false, hint: 'credits' })).toBe('ready');
    expect(tryOnInviteKind({ ready: true, hint: null })).toBe('ready');
  });

  it('the invitation tile is one opaque, labelled button with a 44 pt target — never an outlined pill over a picture', async () => {
    const onPress = jest.fn();
    await render(<TryOnInvite footer="Try it on me · 1 credit" ready onPress={onPress} className="h-60 w-40" />);
    const tile = screen.getByRole('button');
    expect(tile).toHaveProp('accessibilityLabel', 'Try it on me. How would this look sit on you? Try it on me · 1 credit');
    // Opaque ground, no outline, no transparency: the classes that decide legibility.
    const classes = String(tile.props.className ?? '');
    expect(classes).toMatch(/\bbg-sand\b/);
    expect(classes).toMatch(/\bmin-h-icon-btn\b/);
    expect(classes).not.toMatch(/bg-transparent|border-ink|bg-paper\/|opacity-(?!80|60)/);
    expect(screen.getByTestId('try-on-invite-footer')).toHaveTextContent('Try it on me · 1 credit');
    await fireEvent.press(tile);
    expect(onPress).toHaveBeenCalledTimes(1);

    await render(<TryOnInvite footer="Unlocks with membership" ready={false} onPress={onPress} disabled />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});

describe('placeholders by kind', () => {
  it('product row / card without a picture draw the garment glyph; catalogue vocabulary maps to it', async () => {
    await render(<ProductRow brand="Gap" name="Düz Kesim Jean" price={null} category="trousers" color="navy" />);
    expect(screen.getByTestId('image-slot-garment')).toBeTruthy();
    await render(<ProductCard brand="Gap" name="Triko" price={null} category="knit" color="camel" favorite={false} onToggleFavorite={() => undefined} onPress={() => undefined} />);
    expect(screen.getAllByTestId('image-slot-garment').length).toBeGreaterThan(0);
    expect(asGarmentCategory('trousers')).toBe('bottom');
    expect(asGarmentCategory('jacket')).toBe('outerwear');
    expect(asGarmentCategory('knit')).toBe('top');
    expect(asGarmentColor('burgundy')).toBe('red');
    expect(asGarmentColor('olive')).toBe('green');
  });

  it('a look card without an image shows the collage of its pieces, or the figure when it has none', async () => {
    await render(<LookCard name="Lacivert Blazer" tag="Office" pieces={[{ category: 'top' }, { category: 'bottom' }]} onPress={() => undefined} />);
    expect(screen.getByTestId('image-slot-flatlay')).toBeTruthy();
    await render(<LookCard name="Tüvit" tag="Weekend" seed="look_2" onPress={() => undefined} />);
    expect(screen.getByTestId('image-slot-figure')).toBeTruthy();
  });

  it('thumbnail covers keep the figure unless a piece has a photograph', () => {
    const slot = { slot: 'top', source: 'wardrobe', refId: 'i1', name: 'Gömlek', imageUrl: null, brand: null, price: null, deleted: false } as const;
    expect(coverPieces([slot], undefined, 45)).toEqual([]);
    expect(coverPieces([{ ...slot, imageUrl: 'https://example.com/i.jpg' }], undefined, 45)).toHaveLength(1);
    expect(coverPieces([slot], undefined, 130)).toEqual([{ category: 'top', color: 'other', imageUrl: null, missing: false }]);
  });

  it('a person without a photo shows initials', async () => {
    await render(<Avatar name="Selin Yıldız" uri={null} />);
    expect(screen.getByTestId('image-slot-avatar')).toBeTruthy();
    expect(screen.getByText('SY')).toBeTruthy();
    await render(<Avatar name="@ornek_stilist" />);
    expect(screen.getByText('OS')).toBeTruthy();
  });
});

describe('library rows (04b / 12b)', () => {
  const wire = { id: 'lib_1', name: 'Lacivert blazer', category: 'outerwear', colorIds: ['navy'], fabric: null, seasons: [], imageUrl: null };

  it('keeps a null picture as null and carries the main colour for the placeholder', () => {
    expect(toLibraryItem(wire)).toEqual({ id: 'lib_1', name: 'Lacivert blazer', category: 'outerwear', subcategory: null, imageUrl: null, color: 'navy' });
    expect(toLibraryItem({ ...wire, colorIds: [] }).color).toBeNull();
  });

  it('passes a picture URL through untouched', () => {
    expect(toLibraryItem({ ...wire, imageUrl: 'https://cdn.example.com/lib_1.jpg' }).imageUrl).toBe('https://cdn.example.com/lib_1.jpg');
  });
});
