import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { Item } from '@/api/contracts/wardrobe';
import { toJob, toPhotoIssue } from '@/api/wire/core';
import { toStylistResult, type OutfitResultWire } from '@/api/wire/stylist';
import { toPlanWeekResult, type WeekResultWire } from '@/api/wire/today';
import { toTripPlan, type PackResultWire } from '@/api/wire/trips';
import i18n from '@/i18n';

import { addedLibraryPieces, GapFillBanner } from './gapFill';
import { SuggestionPieces } from './SuggestionPieces';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
beforeEach(() => addedLibraryPieces.reset());

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const top: Item = {
  id: 'I1',
  name: 'White shirt',
  category: 'top',
  subcategory: null,
  brand: null,
  size: null,
  color: 'white',
  fabric: null,
  seasons: ['autumn'],
  imageUrl: null,
  originalImageUrl: null,
  useOriginalImage: false,
  wearCount: 0,
  lastWornAt: null,
  createdAt: '2026-11-01T00:00:00Z',
  baseVersion: 1,
};

/** A thin wardrobe (one top): the stylist filled bottom and shoes from the library, the bag from the store. */
const thin: OutfitResultWire = {
  date: '2026-11-19',
  occasion: 'office',
  onlyMyWardrobe: true,
  refusal: null,
  language: 'en',
  gapFilled: true,
  suggestions: [
    {
      index: 0,
      title: null,
      explanation: null,
      source: 'rule',
      slots: [{ slot: 'top', itemId: 'I1', productId: null }],
      missing: [
        { slot: 'bottom', category: 'bottom', reason: 'emptySlot', productId: null, libraryItemId: 'lib-black-trousers' },
        { slot: 'shoes', category: 'shoes', reason: 'emptySlot', productId: null, libraryItemId: 'lib-white-sneakers' },
        { slot: 'bagAccessory', category: 'bag', reason: 'emptySlot', productId: 'P1', libraryItemId: null },
      ],
    },
  ],
};

const library = new Map([
  ['lib-black-trousers', { id: 'lib-black-trousers', name: 'Black trousers', category: 'bottom', imageUrl: null, color: 'black' }],
  ['lib-white-sneakers', { id: 'lib-white-sneakers', name: 'White sneakers', category: 'shoes', imageUrl: null, color: 'white' }],
]);
const products = new Map([
  ['P1', { id: 'P1', name: 'Tote', brandName: 'Brand', priceMinor: 99900, currency: 'TRY', images: [], category: 'bag' } as never],
]);

describe('gap filling (owner decision 3)', () => {
  it('maps own pieces, library picks and store picks; a library pick already owned shows as the user’s piece', () => {
    const result = toStylistResult(thin, { items: new Map([['I1', top]]), products, library });
    expect(result.gapFilled).toBe(true);
    expect(result.refusal).toBeNull();
    expect(result.suggestions[0]?.pieces.map((p) => [p.source, p.refId, p.suggested ?? false])).toEqual([
      ['wardrobe', 'I1', false],
      ['library', 'lib-black-trousers', true],
      ['library', 'lib-white-sneakers', true],
      ['store', 'P1', true],
    ]);
    const owned: Item = { ...top, id: 'I2', name: 'Black trousers', category: 'bottom', libraryItemId: 'lib-black-trousers' };
    const again = toStylistResult(thin, { items: new Map([['I1', top], ['I2', owned]]), products, library });
    expect(again.suggestions[0]?.pieces[1]).toMatchObject({ source: 'wardrobe', refId: 'I2' });
  });

  it('labels the picks "Suggested · Library" (one tap "Add to wardrobe") and "Suggested · Store" ("See")', async () => {
    const pieces = toStylistResult(thin, { items: new Map([['I1', top]]), products, library }).suggestions[0]?.pieces ?? [];
    await render(wrap(<SuggestionPieces pieces={pieces} />));
    expect(screen.getAllByText('Suggested · Library')).toHaveLength(2);
    expect(screen.getByText('Suggested · Store')).toBeTruthy();
    expect(screen.getByTestId('suggested-library-add-lib-black-trousers')).toBeTruthy();
    expect(screen.getByTestId('suggested-store-P1')).toHaveTextContent('See');
    await fireEvent.press(screen.getByTestId('suggested-library-add-lib-black-trousers'));
    await waitFor(() => expect(addedLibraryPieces.has('lib-black-trousers')).toBe(true));
    await waitFor(() => expect(screen.queryByTestId('suggested-library-add-lib-black-trousers')).toBeNull());
  });

  it('the soft banner replaces the dead end and adds every library pick at once', async () => {
    await render(wrap(<GapFillBanner libraryItemIds={['lib-black-trousers', 'lib-white-sneakers']} />));
    expect(screen.getByText(/Some of these suggestions aren.t from your wardrobe/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('gapfill.banner.addAll'));
    await waitFor(() => expect(screen.getByText('Added to your wardrobe')).toBeTruthy());
    expect(addedLibraryPieces.has('lib-white-sneakers')).toBe(true);
  });

  it('week and trip drafts carry the picks too', () => {
    const week: WeekResultWire = {
      weekStart: '2026-11-16',
      refusal: null,
      language: 'en',
      gapFilled: true,
      days: [
        {
          date: '2026-11-16',
          occasion: 'office',
          outfit: { index: 0, title: null, explanation: null, source: 'rule', slots: [{ slot: 'top', itemId: 'I1', productId: null }], missing: [{ slot: 'shoes', libraryItemId: 'lib-white-sneakers', productId: null }] },
        },
      ],
    };
    expect(toPlanWeekResult(week, { jobId: 'J', untitled: 'Look' })).toMatchObject({ gapFilled: true, libraryItemIds: ['lib-white-sneakers'], days: [{ suggested: 1 }] });
    const pack = {
      tripId: 'T',
      cabinOnly: false,
      everyPieceWornTwice: false,
      source: 'rule',
      refusal: null,
      language: 'en',
      items: [],
      days: [],
      missing: [{ slot: 'shoes', category: 'shoes', reason: 'emptySlot', productId: null, libraryItemId: 'lib-white-sneakers' }],
      cabinLimit: null,
      cabinTrimmed: false,
      droppedItemIds: [],
      gapFilled: true,
    } satisfies PackResultWire;
    const plan = toTripPlan(pack, new Map());
    expect(plan.gapFilled).toBe(true);
    expect(plan.missing[0]?.libraryItemId).toBe('lib-white-sneakers');
  });
});

describe('photo rejected on the first try-on (no credit used)', () => {
  it('maps photoUnsuitable with its reason and photo kind', async () => {
    const job = await toJob({
      id: 'J',
      kind: 'tryOn',
      status: 'failed',
      failure: 'photoUnsuitable',
      result: { photoIssue: 'tooDark', photoKind: 'body' },
      createdAt: '',
      updatedAt: '',
    });
    expect(job.error).toEqual({ code: 'photo_unsuitable', creditRefunded: true, photo: { issue: 'tooDark', kind: 'body' } });
    expect(toPhotoIssue({ photoKind: 'face' })).toEqual({ issue: 'noFace', kind: 'face' });
  });
});
