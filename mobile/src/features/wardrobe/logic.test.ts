import { BULK_ADD_MAX, type Item, type ItemDraft } from '@/api/contracts/wardrobe';
import { fixtureDb, resetFixtureDb } from '@/fixtures/db';
import {
  fixtureConfirmDrafts,
  fixtureCreateDrafts,
  fixtureDeleteItem,
  fixtureDraftOptions,
  fixtureListDrafts,
  fixturePutItem,
  fixtureRetryDraft,
  resetFixtureDrafts,
} from '@/fixtures/wardrobe';

import { applyFilters, BRAND_OTHER, brandOptions, DEFAULT_FILTERS, foldTr, isFiltering, matchesSearch, sheetFilterCount, toggleIn } from './filters';
import {
  draftProgress,
  EMPTY_FORM,
  fieldsOf,
  formFromDraft,
  formFromItem,
  isDraftComplete,
  libraryCategory,
  libraryItemFields,
  limitBulkSelection,
  toItemFields,
  validateItemForm,
} from './form';
import { buildConfirmVariables } from './mutations';
import { padToColumns } from './parts';

jest.mock('expo-file-system', () => ({ File: jest.fn(), UploadType: { BINARY_CONTENT: 0 } }));

const items = (): Item[] => fixtureDb.items;
const names = (list: Item[]) => list.map((i) => i.name);

beforeEach(() => {
  resetFixtureDb();
  resetFixtureDrafts();
});

describe('search (Turkish-insensitive)', () => {
  it('folds İ/I/ı/i and diacritics', () => {
    expect(foldTr('İPEK')).toBe(foldTr('ipek'));
    expect(foldTr('IŞIK')).toBe(foldTr('ışık'));
    expect(foldTr('Gömlek')).toBe('gomlek');
  });

  it('matches name, type, fabric and brand, every word required', () => {
    const fular = items().find((i) => i.id === 'item_silk_scarf');
    expect(fular).toBeDefined();
    if (!fular) return;
    expect(matchesSearch(fular, 'IPEK')).toBe(true);
    expect(matchesSearch(fular, 'ipek fular')).toBe(true);
    expect(matchesSearch(fular, 'ipek blazer')).toBe(false);
    expect(names(applyFilters(items(), { ...DEFAULT_FILTERS, search: 'vakko' }))).toEqual(expect.arrayContaining(['Lacivert yün blazer', 'Siyah deri çanta']));
    expect(names(applyFilters(items(), { ...DEFAULT_FILTERS, search: 'YUN' }))).toContain('Krem triko');
    expect(applyFilters(items(), { ...DEFAULT_FILTERS, search: '   ' })).toHaveLength(items().length);
  });
});

describe('filters and sort', () => {
  it('filters by category, season, colour (AND across groups, OR inside a group)', () => {
    const shoes = applyFilters(items(), { ...DEFAULT_FILTERS, category: 'shoes' });
    expect(names(shoes).sort()).toEqual(['Beyaz sneaker', 'Kroko babet', 'Siyah bot']);
    const winterShoes = applyFilters(items(), { ...DEFAULT_FILTERS, category: 'shoes', seasons: ['winter'] });
    expect(names(winterShoes)).toEqual(['Siyah bot']);
    const blackOrWhite = applyFilters(items(), { ...DEFAULT_FILTERS, category: 'shoes', colors: ['black', 'white'] });
    expect(names(blackOrWhite).sort()).toEqual(['Beyaz sneaker', 'Siyah bot']);
  });

  it('offers brands A→Z with "Diğer" last, and "Diğer" selects pieces without a brand', () => {
    expect(brandOptions(items())).toEqual(['Gap', 'Marks & Spencer', 'Vakko', BRAND_OTHER]);
    expect(brandOptions([{ brand: 'Gap' }])).toEqual(['Gap']);
    const other = applyFilters(items(), { ...DEFAULT_FILTERS, brands: [BRAND_OTHER] });
    expect(other.length).toBeGreaterThan(0);
    expect(other.every((i) => !i.brand)).toBe(true);
    const gapOrOther = applyFilters(items(), { ...DEFAULT_FILTERS, brands: ['Gap', BRAND_OTHER] });
    expect(gapOrOther).toHaveLength(other.length + 1);
  });

  it('sorts by wear count both ways and newest first', () => {
    expect(applyFilters(items(), { ...DEFAULT_FILTERS, sort: 'mostWorn' })[0]?.name).toBe('Siyah deri çanta');
    expect(applyFilters(items(), { ...DEFAULT_FILTERS, sort: 'leastWorn' })[0]?.name).toBe('Keten gömlek');
    const newer: Item = { ...(items()[0] as Item), id: 'item_new', name: 'Yeni', createdAt: '2026-11-18T10:00:00.000Z' };
    expect(applyFilters([...items(), newer], DEFAULT_FILTERS)[0]?.id).toBe('item_new');
  });

  it('does not mutate the list and counts active filters', () => {
    const before = names(items());
    applyFilters(items(), { ...DEFAULT_FILTERS, sort: 'mostWorn' });
    expect(names(items())).toEqual(before);
    expect(sheetFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(sheetFilterCount({ ...DEFAULT_FILTERS, seasons: ['winter'], colors: ['black'], sort: 'mostWorn' })).toBe(3);
    expect(isFiltering(DEFAULT_FILTERS)).toBe(false);
    expect(isFiltering({ ...DEFAULT_FILTERS, category: 'top' })).toBe(true);
    expect(toggleIn(['a'], 'a')).toEqual([]);
    expect(toggleIn(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('pads the last grid row', () => {
    expect(padToColumns([1, 2, 3, 4])).toEqual([1, 2, 3, 4, null, null]);
    expect(padToColumns([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe('item form (12c)', () => {
  it('requires at least one season', () => {
    const blazer = items().find((i) => i.id === 'item_navy_blazer') as Item;
    const values = formFromItem(blazer);
    expect(validateItemForm(values)).toEqual({});
    expect(validateItemForm({ ...values, seasons: [] })).toEqual({ seasons: 'seasonRequired' });
  });

  it('requires name, category and colour for a manual entry', () => {
    expect(validateItemForm(EMPTY_FORM)).toEqual({
      name: 'nameRequired',
      category: 'categoryRequired',
      color: 'colorRequired',
      seasons: 'seasonRequired',
    });
    expect(validateItemForm({ ...EMPTY_FORM, name: 'x'.repeat(81) }).name).toBe('nameTooLong');
    expect(() => toItemFields(EMPTY_FORM)).toThrow();
  });

  it('trims text and turns blanks into null', () => {
    const fields = toItemFields({ ...EMPTY_FORM, name: '  Bluz ', category: 'top', color: 'white', seasons: ['summer'], brand: '  ', fabric: ' Keten ' });
    expect(fields).toMatchObject({ name: 'Bluz', brand: null, fabric: 'Keten', size: null, subcategory: null });
  });

  it('round-trips an item through the form', () => {
    const blazer = items().find((i) => i.id === 'item_navy_blazer') as Item;
    expect(toItemFields(formFromItem(blazer))).toEqual(fieldsOf(blazer));
  });

  it('maps library pieces to neutral wardrobe fields', () => {
    expect(libraryCategory('outerwear')).toBe('outerwear');
    expect(libraryCategory('hat')).toBe('accessory');
    const fields = libraryItemFields({ name: 'Trençkot', category: 'outerwear' });
    expect(fields).toMatchObject({ name: 'Trençkot', category: 'outerwear', color: 'other' });
    expect(fields.seasons).toHaveLength(4);
    expect(validateItemForm(formFromItem(fields))).toEqual({});
  });
});

describe('bulk add (13)', () => {
  it(`accepts at most ${BULK_ADD_MAX} photos per batch`, () => {
    const photos = Array.from({ length: 34 }, (_, i) => i);
    expect(limitBulkSelection(photos, 0)).toMatchObject({ rejected: 4 });
    expect(limitBulkSelection(photos, 0).accepted).toHaveLength(BULK_ADD_MAX);
    expect(limitBulkSelection(photos, 28).accepted).toEqual([0, 1]);
    expect(limitBulkSelection(photos, 30)).toEqual({ accepted: [], rejected: 34 });
    expect(limitBulkSelection([1, 2], 5)).toEqual({ accepted: [1, 2], rejected: 0 });
  });

  it('counts progress as ready + failed', () => {
    const drafts = (['ready', 'ready', 'failed', 'processing', 'processing'] as const).map((status) => ({ status }));
    expect(draftProgress(drafts)).toEqual({ total: 5, done: 3, ready: 2, failed: 1, processing: 2 });
    expect(draftProgress([])).toEqual({ total: 0, done: 0, ready: 0, failed: 0, processing: 0 });
  });

  it('only complete, ready drafts can be added without editing', () => {
    const ready: Pick<ItemDraft, 'status' | 'suggestion'> = {
      status: 'ready',
      suggestion: { name: 'Düz jean', category: 'bottom', color: 'blue', seasons: ['autumn'] },
    };
    expect(isDraftComplete(ready)).toBe(true);
    expect(isDraftComplete({ ...ready, suggestion: { ...ready.suggestion, seasons: [] } })).toBe(false);
    expect(isDraftComplete({ ...ready, status: 'processing' })).toBe(false);
    expect(formFromDraft({ suggestion: null })).toEqual(EMPTY_FORM);
  });

  it('creates stable ids at action time for the confirm request', () => {
    const fields = fieldsOf(items()[0] as Item);
    const vars = buildConfirmVariables([
      { fields, draftId: 'd1', preview: 'file://a.jpg' },
      { fields, draftId: null, libraryItemId: 'lib_1' },
    ]);
    const [a, b] = vars.request.items;
    expect(a?.id).toBeTruthy();
    expect(a?.clientMutationId).toBeTruthy();
    // Previews are keyed by the new item's id. Checked on a single-item request of its own: the test
    // id generator is time-based only, so two calls (or two items) may or may not share a millisecond.
    const single = buildConfirmVariables([{ fields, draftId: 'd1', preview: 'file://a.jpg' }]);
    expect(single.previews).toEqual({ [single.request.items[0]?.id ?? '']: 'file://a.jpg' });
    expect(b).toMatchObject({ draftId: null, libraryItemId: 'lib_1', reviewed: true });
  });
});

describe('wardrobe fixtures', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('drafts process over time, flag low confidence, and are idempotent on requestId', () => {
    fixtureDraftOptions.baseMs = 1000;
    fixtureDraftOptions.stepMs = 1000;
    const res = fixtureCreateDrafts({ requestId: 'r1', photoKeys: ['file://1.jpg', 'file://2.jpg', 'file://3.jpg'] });
    expect(fixtureCreateDrafts({ requestId: 'r1', photoKeys: ['file://1.jpg'] }).draftIds).toEqual(res.draftIds);
    expect(draftProgress(fixtureListDrafts())).toMatchObject({ total: 3, done: 0 });
    jest.advanceTimersByTime(1500);
    expect(draftProgress(fixtureListDrafts())).toMatchObject({ total: 3, done: 1 });
    jest.advanceTimersByTime(3000);
    const ready = fixtureListDrafts();
    expect(draftProgress(ready)).toMatchObject({ ready: 3 });
    expect(ready[0]?.suggestion?.name).toBeTruthy();
    expect(ready[2]?.lowConfidence).toEqual(['category']);
    expect(ready[0]?.lowConfidence).toEqual([]);
  });

  it('"split outfit" yields several drafts per photo; failed drafts can be retried', () => {
    fixtureDraftOptions.failEvery = 2;
    fixtureDraftOptions.baseMs = 100;
    fixtureDraftOptions.stepMs = 0;
    const res = fixtureCreateDrafts({ requestId: 'r2', photoKeys: ['file://outfit.jpg'], splitOutfit: true });
    expect(res.draftIds).toHaveLength(3);
    jest.advanceTimersByTime(200);
    const failed = fixtureListDrafts().find((d) => d.status === 'failed');
    expect(failed).toBeDefined();
    fixtureRetryDraft(failed?.id ?? '');
    expect(fixtureListDrafts().find((d) => d.id === failed?.id)?.status).toBe('processing');
    jest.advanceTimersByTime(200);
    expect(fixtureListDrafts().find((d) => d.id === failed?.id)?.status).toBe('ready');
  });

  it('confirming a draft creates the item once and removes the draft', () => {
    fixtureDraftOptions.baseMs = 10;
    const { draftIds } = fixtureCreateDrafts({ requestId: 'r3', photoKeys: ['file://1.jpg'] });
    jest.advanceTimersByTime(50);
    const count = items().length;
    const fields = fieldsOf(items()[0] as Item);
    const request = { items: [{ ...fields, name: 'Yeni parça', id: 'item_new', draftId: draftIds[0] ?? null, reviewed: true, clientMutationId: 'm1' }] };
    expect(fixtureConfirmDrafts(request).items[0]).toMatchObject({ id: 'item_new', name: 'Yeni parça', imageUrl: 'file://1.jpg', wearCount: 0 });
    fixtureConfirmDrafts(request);
    expect(items()).toHaveLength(count + 1);
    expect(fixtureListDrafts()).toHaveLength(0);
  });

  it('versioned update bumps the version and rejects a stale one with the current record', () => {
    const blazer = items().find((i) => i.id === 'item_navy_blazer') as Item;
    const saved = fixturePutItem(blazer.id, { ...fieldsOf(blazer), seasons: ['winter'], baseVersion: 1, clientMutationId: 'm' });
    expect(saved).toMatchObject({ seasons: ['winter'], baseVersion: 2 });
    expect(() => fixturePutItem(blazer.id, { ...fieldsOf(blazer), baseVersion: 1, clientMutationId: 'm2' })).toThrow();
  });

  it('deleting a piece marks its look slots as deleted', () => {
    fixtureDeleteItem('item_navy_blazer');
    expect(items().some((i) => i.id === 'item_navy_blazer')).toBe(false);
    const slot = fixtureDb.looks.find((l) => l.id === 'look_lacivert_blazer')?.slots.find((s) => s.refId === 'item_navy_blazer');
    expect(slot?.deleted).toBe(true);
  });
});
