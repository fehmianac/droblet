import type { Look } from '@/api/contracts/looks';
import { fixtureDb, resetFixtureDb } from '@/fixtures/db';

import {
  assignItemsToSlots,
  canSaveLook,
  coverTone,
  filledCount,
  filterLooks,
  lookPieceNames,
  missingPieceCount,
  parseItemIds,
  sameSlots,
  slotForCategory,
  slotMapFromLook,
  toSlotInputs,
} from './logic';

beforeEach(() => resetFixtureDb());

describe('slot assignment from the multi-select', () => {
  it('places each piece into the slot its category fills', () => {
    const { slots, skipped } = assignItemsToSlots(fixtureDb.items, ['item_white_shirt', 'item_straight_jeans', 'item_navy_blazer', 'item_croc_flats', 'item_black_bag']);
    expect(skipped).toEqual([]);
    expect(slots.top?.refId).toBe('item_white_shirt');
    expect(slots.bottom?.refId).toBe('item_straight_jeans');
    expect(slots.outerwear?.refId).toBe('item_navy_blazer');
    expect(slots.shoes?.refId).toBe('item_croc_flats');
    expect(slots.accessory?.refId).toBe('item_black_bag');
    expect(slots.top).toMatchObject({ source: 'wardrobe', name: 'Beyaz poplin gömlek', deleted: false });
  });

  it('a dress fills the top slot; the first piece wins and the rest are skipped', () => {
    const { slots, skipped } = assignItemsToSlots(fixtureDb.items, ['item_black_midi', 'item_white_shirt', 'unknown', 'item_tweed_jacket', 'item_beige_trench']);
    expect(slots.top?.refId).toBe('item_black_midi');
    expect(slots.outerwear?.refId).toBe('item_tweed_jacket');
    expect(skipped).toEqual(['item_white_shirt', 'unknown', 'item_beige_trench']);
  });

  it('maps every category to a slot', () => {
    expect(slotForCategory('dress')).toBe('top');
    expect(slotForCategory('bag')).toBe('accessory');
    expect(slotForCategory('accessory')).toBe('accessory');
    expect(slotForCategory('skiwear')).toBe('top');
  });

  it('parses the itemIds route param', () => {
    expect(parseItemIds('a, b,,a')).toEqual(['a', 'b']);
    expect(parseItemIds(['a', 'b,c'])).toEqual(['a', 'b', 'c']);
    expect(parseItemIds(undefined)).toEqual([]);
  });
});

describe('min 2 pieces rule and save payload', () => {
  it('cannot save with fewer than 2 pieces', () => {
    expect(canSaveLook({})).toBe(false);
    const one = assignItemsToSlots(fixtureDb.items, ['item_white_shirt']).slots;
    expect(filledCount(one)).toBe(1);
    expect(canSaveLook(one)).toBe(false);
    const two = assignItemsToSlots(fixtureDb.items, ['item_white_shirt', 'item_straight_jeans']).slots;
    expect(canSaveLook(two)).toBe(true);
  });

  it('sends only slot, source and refId, in slot order', () => {
    const { slots } = assignItemsToSlots(fixtureDb.items, ['item_croc_flats', 'item_white_shirt']);
    expect(toSlotInputs(slots)).toEqual([
      { slot: 'top', source: 'wardrobe', refId: 'item_white_shirt' },
      { slot: 'shoes', source: 'wardrobe', refId: 'item_croc_flats' },
    ]);
  });

  it('flags a piece that is no longer in the wardrobe and blocks saving until it is replaced', () => {
    const look = fixtureDb.looks.find((l) => l.id === 'look_lacivert_blazer') as Look;
    const items = fixtureDb.items.filter((i) => i.id !== 'item_navy_blazer');
    const slots = slotMapFromLook(look, items);
    expect(slots.outerwear?.deleted).toBe(true);
    expect(slots.top?.deleted).toBe(false);
    expect(canSaveLook(slots)).toBe(false);
    delete slots.outerwear;
    expect(canSaveLook(slots)).toBe(true);
  });

  it('does not flag anything while the wardrobe is unknown (offline without cache)', () => {
    const look = fixtureDb.looks[0] as Look;
    expect(Object.values(slotMapFromLook(look, undefined)).every((s) => !s.deleted)).toBe(true);
  });

  it('compares slot sets regardless of order', () => {
    const a = [
      { slot: 'top', source: 'wardrobe', refId: '1' },
      { slot: 'shoes', source: 'store', refId: '2' },
    ] as const;
    expect(sameSlots([...a], [a[1], a[0]])).toBe(true);
    expect(sameSlots([...a], [a[0]])).toBe(false);
  });
});

describe('filterLooks', () => {
  it('filters by favourites and by occasion', () => {
    const looks = fixtureDb.looks;
    expect(filterLooks(looks, 'all')).toHaveLength(4);
    expect(filterLooks(looks, 'favorites').map((l) => l.id)).toEqual(['look_lacivert_blazer']);
    expect(filterLooks(looks, 'office').map((l) => l.id)).toEqual(['look_lacivert_blazer', 'look_krem_katmanlar']);
    expect(filterLooks(looks, 'travel')).toEqual([]);
  });
});

describe('look detail helpers', () => {
  it('lists the piece names in slot order, without deleted or unnamed pieces', () => {
    const look = fixtureDb.looks.find((l) => l.id === 'look_lacivert_blazer') as Look;
    expect(lookPieceNames(look)).toEqual(['Beyaz poplin gömlek', 'Siyah kumaş pantolon', 'Lacivert yün blazer']);
    const shuffled = { slots: [...look.slots].reverse().map((s, i) => ({ ...s, deleted: i === 0 })) };
    expect(lookPieceNames(shuffled)).toEqual(['Beyaz poplin gömlek', 'Siyah kumaş pantolon']);
  });

  it('counts the store pieces as missing', () => {
    const look = fixtureDb.looks[0] as Look;
    expect(missingPieceCount(look)).toBe(0);
    const withStore = { slots: [...look.slots, { ...(look.slots[0] as Look['slots'][number]), slot: 'shoes' as const, source: 'store' as const }] };
    expect(missingPieceCount(withStore)).toBe(1);
  });

  it('gives a look the same placeholder tone every time', () => {
    expect(coverTone('look_lacivert_blazer')).toBe(coverTone('look_lacivert_blazer'));
    const tones = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(coverTone));
    expect(tones.size).toBeGreaterThan(1);
  });
});
