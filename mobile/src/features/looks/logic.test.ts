import type { Look, LookSlot, LookSlotKind } from '@/api/contracts/looks';
import { fixtureDb, resetFixtureDb } from '@/fixtures/db';

import {
  addPiece,
  assignItemsToSlots,
  canSaveLook,
  coverTone,
  filledCount,
  filterLooks,
  hasRoom,
  lookPieceNames,
  missingPieceCount,
  parseItemIds,
  piecesOf,
  removePiece,
  replacePiece,
  sameSlots,
  slotForCategory,
  slotList,
  slotMapFromLook,
  type SlotMap,
  toSlotInputs,
} from './logic';

beforeEach(() => resetFixtureDb());

describe('slot assignment from the multi-select', () => {
  const refs = (slots: SlotMap, kind: LookSlotKind) => piecesOf(slots, kind).map((p) => p.refId);

  it('places each piece into the box its category fills', () => {
    const { slots, skipped } = assignItemsToSlots(fixtureDb.items, ['item_white_shirt', 'item_straight_jeans', 'item_navy_blazer', 'item_croc_flats', 'item_black_bag']);
    expect(skipped).toEqual([]);
    expect(refs(slots, 'top')).toEqual(['item_white_shirt']);
    expect(refs(slots, 'bottom')).toEqual(['item_straight_jeans']);
    expect(refs(slots, 'outerwear')).toEqual(['item_navy_blazer']);
    expect(refs(slots, 'shoes')).toEqual(['item_croc_flats']);
    expect(refs(slots, 'bag')).toEqual(['item_black_bag']);
    expect(piecesOf(slots, 'top')[0]).toMatchObject({ source: 'wardrobe', name: 'Beyaz poplin gömlek', deleted: false });
  });

  it('layers: a dress and a shirt share the top box; a box that is full skips the rest', () => {
    const { slots, skipped } = assignItemsToSlots(fixtureDb.items, ['item_black_midi', 'item_white_shirt', 'unknown', 'item_tweed_jacket', 'item_beige_trench']);
    expect(refs(slots, 'top')).toEqual(['item_black_midi', 'item_white_shirt']);
    expect(refs(slots, 'outerwear')).toEqual(['item_tweed_jacket']);
    expect(skipped).toEqual(['unknown', 'item_beige_trench']);
  });

  it('a box holds its capacity: 3 top layers, 4 accessories, one of the rest; 12 pieces at most', () => {
    const piece = (slot: LookSlotKind, refId: string): LookSlot => ({ slot, source: 'wardrobe', refId, name: refId, imageUrl: null, brand: null, price: null, deleted: false });
    let slots: SlotMap = [];
    for (const id of ['t1', 't2', 't3', 't4']) slots = addPiece(slots, piece('top', id));
    expect(refs(slots, 'top')).toEqual(['t1', 't2', 't3']);
    expect(hasRoom(slots, 'top')).toBe(false);
    for (const id of ['a1', 'a2', 'a3', 'a4', 'a5']) slots = addPiece(slots, piece('accessory', id));
    expect(refs(slots, 'accessory')).toEqual(['a1', 'a2', 'a3', 'a4']);
    slots = addPiece(addPiece(slots, piece('socks', 's1')), piece('socks', 's2'));
    expect(refs(slots, 'socks')).toEqual(['s1']);
    // The same piece is never worn twice; replacing keeps the layer's place; removing frees it.
    expect(addPiece(slots, piece('top', 't1'))).toBe(slots);
    slots = replacePiece(slots, piece('top', 't2'), piece('top', 't9'));
    expect(refs(slots, 'top')).toEqual(['t1', 't9', 't3']);
    slots = removePiece(slots, piece('top', 't1'));
    expect(refs(slots, 'top')).toEqual(['t9', 't3']);
    expect(hasRoom(slots, 'top')).toBe(true);
    expect(slotList(slots).map((p) => p.slot)).toEqual(['top', 'top', 'socks', 'accessory', 'accessory', 'accessory', 'accessory']);
  });

  it('maps every category to a box', () => {
    expect(slotForCategory('dress')).toBe('top');
    expect(slotForCategory('bag')).toBe('bag');
    expect(slotForCategory('accessory')).toBe('accessory');
    expect(slotForCategory('socks')).toBe('socks');
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
    expect(canSaveLook([])).toBe(false);
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
    const outerwear = piecesOf(slots, 'outerwear')[0] as LookSlot;
    expect(outerwear.deleted).toBe(true);
    expect(piecesOf(slots, 'top')[0]?.deleted).toBe(false);
    expect(canSaveLook(slots)).toBe(false);
    expect(canSaveLook(removePiece(slots, outerwear))).toBe(true);
  });

  it('does not flag anything while the wardrobe is unknown (offline without cache)', () => {
    const look = fixtureDb.looks[0] as Look;
    expect(slotMapFromLook(look, undefined).every((s) => !s.deleted)).toBe(true);
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
