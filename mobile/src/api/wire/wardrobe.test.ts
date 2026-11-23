import i18n from '@/i18n';

import type { Item } from '../contracts/wardrobe';
import type { ProductWire } from './catalog';
import {
  fromItemFields,
  fromOccasion,
  fromSlotInput,
  normalizeColorHex,
  toColorIds,
  toFabricId,
  toFabricLabel,
  toItem,
  toItemColor,
  toItemDetail,
  toItemDraft,
  toItemDrafts,
  toLook,
  type ItemDraftWire,
  type ItemWire,
  type LookWire,
} from './wardrobe';

const itemWire: ItemWire = {
  id: '01JITEM',
  name: 'Lacivert blazer',
  category: 'outerwear',
  colorIds: ['burgundy', 'navy'],
  fabric: 'wool',
  seasons: ['autumn', 'winter'],
  size: 'M',
  brand: 'Mango',
  source: 'photo',
  productId: null,
  libraryItemId: null,
  imageUrl: 'https://img/clean',
  imageUrlExpiresAt: '2026-11-18T09:05:00Z',
  hasOriginalImage: true,
  useOriginalImage: false,
  wearCount: 3,
  lastWornAt: '2026-11-17',
  listingStatus: 'none',
  createdAt: '2026-11-01T09:00:00Z',
  updatedAt: '2026-11-02T09:00:00Z',
  version: 2,
};

const lookWire: LookWire = {
  id: '01JLOOK',
  name: 'Ofis',
  occasion: 'office',
  slots: [
    { slot: 'top', itemId: '01JITEM', productId: null, missing: false, unavailable: false },
    { slot: 'bottom', itemId: '01JGONE', productId: null, missing: false, unavailable: true },
    { slot: 'bagAccessory', itemId: null, productId: 'lx-bag', missing: true, unavailable: false },
  ],
  pieceCount: 3,
  hasMissingPieces: true,
  favorite: true,
  source: 'user',
  createdAt: '2026-11-03T09:00:00Z',
  updatedAt: '2026-11-03T09:00:00Z',
  version: 4,
  rating: { average: 4.5, count: 2 },
};

const product = {
  id: 'lx-bag',
  brandName: 'Vakko',
  name: 'Deri El Çantası',
  priceMinor: 1250000,
  currency: 'TRY',
  images: ['https://cdn/bag.jpg'],
} as ProductWire;

describe('wardrobe wire mappers', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('tr');
  });

  it('maps an ItemDto to the app item (colour family, fabric name, version)', () => {
    const item = toItem(itemWire);
    expect(item).toMatchObject({
      id: '01JITEM',
      color: 'red',
      colorIds: ['burgundy', 'navy'],
      fabric: 'Yün',
      baseVersion: 2,
      hasOriginalImage: true,
      originalImageUrl: null,
      wearCount: 3,
      lastWornAt: '2026-11-17',
    });
    expect(toItem({ ...itemWire, useOriginalImage: true }).originalImageUrl).toBe('https://img/clean');
  });

  it('image variants: older servers (no thumb / medium / cache key) read as null; new ones are kept', () => {
    expect(toItem(itemWire)).toMatchObject({ thumbUrl: null, mediumUrl: null, imageCacheKey: null, imageUrlExpiresAt: '2026-11-18T09:05:00Z' });
    const cdn = toItem({
      ...itemWire,
      imageUrl: 'https://cdn/i/full.webp',
      imageUrlExpiresAt: null,
      thumbUrl: 'https://cdn/i/256.webp',
      mediumUrl: 'https://cdn/i/768.webp',
      imageCacheKey: 'item:01JITEM:v3',
    });
    expect(cdn).toMatchObject({
      imageUrl: 'https://cdn/i/full.webp',
      thumbUrl: 'https://cdn/i/256.webp',
      mediumUrl: 'https://cdn/i/768.webp',
      imageCacheKey: 'item:01JITEM:v3',
      imageUrlExpiresAt: null,
    });
    // A look slot pointing at the piece carries its variants (tiles pick the thumb).
    const look = toLook(lookWire, { items: new Map([['01JITEM', cdn]]), products: new Map([['lx-bag', product]]) });
    expect(look.slots[0]).toMatchObject({ thumbUrl: 'https://cdn/i/256.webp', mediumUrl: 'https://cdn/i/768.webp', imageCacheKey: 'item:01JITEM:v3' });
  });

  it('colour ids: keeps the server ids while the colour is unchanged, maps app keys otherwise', () => {
    expect(toItemColor('icy-blue')).toBe('blue');
    expect(toItemColor('mustard')).toBe('other');
    expect(toItemColor(undefined)).toBe('other');
    expect(toColorIds('red', ['burgundy', 'navy'])).toEqual(['burgundy', 'navy']);
    expect(toColorIds('black', ['burgundy'])).toEqual(['black']);
    expect(toColorIds('blue')).toEqual(['cobalt']);
    expect(toColorIds('other')).toEqual(['other']);
    expect(toColorIds('other', ['mustard'])).toEqual(['mustard']);
    expect(toColorIds('other', ['black'])).toEqual(['other']);
  });

  it('keeps the lossy fields: subcategory, free-text fabric, colour other + hex', () => {
    const wire: ItemWire = { ...itemWire, subcategory: 'blazer', colorIds: ['other'], colorHex: '#AABBCC', fabric: null, fabricText: 'Bambu karışım' };
    const item = toItem(wire);
    expect(item).toMatchObject({ subcategory: 'blazer', color: 'other', colorHex: '#AABBCC', fabric: 'Bambu karışım' });
    expect(fromItemFields(item)).toMatchObject({
      subcategory: 'blazer',
      colorIds: ['other'],
      colorHex: '#AABBCC',
      fabric: null,
      fabricText: 'Bambu karışım',
    });
    // A hex only travels with the `other` colour; malformed hex is not sent.
    expect(fromItemFields({ ...item, color: 'black', colorIds: undefined }).colorHex).toBeNull();
    expect(fromItemFields({ ...item, colorHex: 'nothex' }).colorHex).toBeNull();
    expect(normalizeColorHex('aabbcc')).toBe('#AABBCC');
    // A manual piece without a photo or name.
    expect(toItem({ ...itemWire, name: null, imageUrl: null, source: 'manual' })).toMatchObject({ name: '', imageUrl: null });
  });

  it('fabric text ↔ reference id', async () => {
    expect(toFabricId('Pamuk')).toBe('cotton');
    expect(toFabricId(' yün ')).toBe('wool');
    expect(toFabricId('İpek')).toBe('silk');
    expect(toFabricId('Leather')).toBe('leather');
    expect(toFabricId('knit')).toBe('knit');
    expect(toFabricId('bilinmeyen')).toBeNull();
    expect(toFabricId('')).toBeNull();
    expect(toFabricLabel('linen')).toBe('Keten');
    expect(toFabricLabel('mystery')).toBe('mystery');
    await i18n.changeLanguage('en');
    expect(toFabricLabel('linen')).toBe('Linen');
    await i18n.changeLanguage('tr');
  });

  it('builds the PUT / confirm fields the server accepts', () => {
    const fields: Pick<Item, 'name' | 'category' | 'brand' | 'size' | 'color' | 'colorIds' | 'fabric' | 'seasons' | 'useOriginalImage'> = {
      name: 'Krem kazak',
      category: 'top',
      brand: null,
      size: 'M',
      color: 'cream',
      fabric: 'Triko',
      seasons: ['winter'],
      useOriginalImage: false,
    };
    expect(fromItemFields(fields)).toEqual({
      name: 'Krem kazak',
      category: 'top',
      subcategory: null,
      colorIds: ['cream'],
      colorHex: null,
      fabric: 'knit',
      fabricText: null,
      seasons: ['winter'],
      size: 'M',
      brand: null,
      useOriginalImage: false,
    });
    expect(fromItemFields({ ...fields, color: 'red' }, ['burgundy']).colorIds).toEqual(['burgundy']);
  });

  it('item detail carries the looks that use the piece', () => {
    const detail = toItemDetail({ item: itemWire, looks: [lookWire] });
    expect(detail.id).toBe('01JITEM');
    expect(detail.looks).toEqual([{ id: '01JLOOK', name: 'Ofis', occasion: 'office', imageUrl: null }]);
  });

  it('maps drafts: status, suggestion, flagged fields, split sources', () => {
    const base: ItemDraftWire = {
      id: 'd1',
      kind: 'single',
      status: 'ready',
      jobId: 'j1',
      parentDraftId: null,
      imageUrl: 'https://img/clean',
      originalImageUrl: 'https://img/orig',
      imageUrlExpiresAt: null,
      name: 'Lacivert blazer',
      category: 'outerwear',
      colorIds: ['navy'],
      fabric: 'wool',
      seasons: ['autumn'],
      flaggedFields: ['colorIds'],
      needsReview: true,
      language: 'tr',
      createdAt: '2026-11-18T09:00:00Z',
    };
    const ready = toItemDraft(base);
    expect(ready.status).toBe('ready');
    expect(ready.suggestion).toEqual({ name: 'Lacivert blazer', category: 'outerwear', color: 'navy', colorIds: ['navy'], fabric: 'Yün', seasons: ['autumn'] });
    expect(ready.lowConfidence).toEqual(['category', 'color']);

    // A manual draft is ready without suggestions: the form starts empty.
    const manual = toItemDraft({ ...base, name: null, category: null, colorIds: [], fabric: null, seasons: [], flaggedFields: [], needsReview: false, jobId: null });
    expect(manual.suggestion).toEqual({});
    expect(manual.lowConfidence).toEqual([]);

    expect(toItemDraft({ ...base, status: 'uploaded' }).status).toBe('processing');
    const failed = toItemDraft({ ...base, status: 'failed', imageUrl: null });
    expect(failed).toMatchObject({ status: 'failed', suggestion: null, imageUrl: 'https://img/orig' });

    const list = toItemDrafts({
      drafts: [base, { ...base, id: 'o1', kind: 'outfit' }, { ...base, id: 'o2', kind: 'outfit', status: 'processing' }, { ...base, id: 'p1', kind: 'piece', parentDraftId: 'o1' }],
      total: 4,
      processed: 3,
    });
    // A ready group photo is listed only while its pieces wait for the chooser, so it is kept as a group.
    expect(list.map((d) => d.id)).toEqual(['d1', 'o1', 'o2', 'p1']);
    expect(list.map((d) => d.kind)).toEqual(['single', 'group', 'group', 'piece']);
    expect(list[3]?.groupId).toBe('o1');
  });

  it('joins look slots with the wardrobe and the catalogue', () => {
    const items = new Map([['01JITEM', toItem(itemWire)]]);
    const look = toLook(lookWire, { items, products: new Map([['lx-bag', product]]) });
    expect(look).toMatchObject({ id: '01JLOOK', isFavorite: true, rating: 4.5, ratingCount: 2, baseVersion: 4, occasion: 'office' });
    expect(look.slots).toEqual([
      {
        slot: 'top',
        source: 'wardrobe',
        refId: '01JITEM',
        name: 'Lacivert blazer',
        imageUrl: 'https://img/clean',
        imageUrlExpiresAt: '2026-11-18T09:05:00Z',
        brand: 'Mango',
        price: null,
        deleted: false,
      },
      { slot: 'bottom', source: 'wardrobe', refId: '01JGONE', name: '', imageUrl: null, brand: null, price: null, deleted: true },
      {
        slot: 'accessory',
        source: 'store',
        refId: 'lx-bag',
        name: 'Deri El Çantası',
        imageUrl: 'https://cdn/bag.jpg',
        brand: 'Vakko',
        price: { amountMinor: 1250000, currency: 'TRY' },
        deleted: false,
      },
    ]);
    expect(toLook({ ...lookWire, rating: null, occasion: null }, { items, products: new Map() })).toMatchObject({ rating: null, ratingCount: 0, occasion: 'weekend' });
  });

  it('Akış F2: reads the share state and its numbers; an older server reads as not shared; an imported look is marked', () => {
    const ctx = { items: new Map(), products: new Map() };
    expect(toLook(lookWire, ctx)).toMatchObject({ sharedToFeed: false, feedStats: null, imported: false });
    expect(toLook({ ...lookWire, sharedToFeed: true, feedStats: { likeCount: 38, saveCount: 12 } }, ctx)).toMatchObject({
      sharedToFeed: true,
      feedStats: { likeCount: 38, saveCount: 12 },
    });
    expect(toLook({ ...lookWire, sharedToFeed: true, feedStats: null }, ctx)).toMatchObject({ sharedToFeed: true, feedStats: null });
    expect(toLook({ ...lookWire, source: 'import' }, ctx).imported).toBe(true);
  });

  it('writes slots and occasions in the wire spelling', () => {
    expect(fromSlotInput({ slot: 'accessory', source: 'store', refId: 'lx-bag' })).toEqual({ slot: 'bagAccessory', productId: 'lx-bag' });
    expect(fromSlotInput({ slot: 'top', source: 'wardrobe', refId: '01JITEM' })).toEqual({ slot: 'top', itemId: '01JITEM' });
    expect(fromOccasion('evening')).toBe('dinner');
    expect(fromOccasion('office')).toBe('office');
    expect(fromOccasion(null)).toBeNull();
  });
});
