import type { ItemFields } from '@/api/contracts/wardrobe';
import { cameraStateOf } from '@/features/photos/cameraState';
import { fixtureDb, resetFixtureDb } from '@/fixtures/db';
import { fixtureConfirmDrafts, resetFixtureDrafts } from '@/fixtures/wardrobe';

import { buildConfirmVariables, withManualPhotos } from './mutations';

jest.mock('expo-file-system', () => ({ File: jest.fn(), UploadType: { BINARY_CONTENT: 0 } }));
// Jest has no random source for ULIDs: two ids made in the same millisecond would be equal.
jest.mock('@/lib/ids', () => {
  let n = 0;
  return { ulid: () => `id_${String(++n).padStart(4, '0')}` };
});

const fields: ItemFields = {
  name: 'Keten gömlek',
  category: 'top',
  subcategory: null,
  brand: null,
  size: null,
  color: 'white',
  fabric: null,
  seasons: ['summer'],
  useOriginalImage: true,
};

beforeEach(() => {
  resetFixtureDb();
  resetFixtureDrafts();
});

describe('manual entry with the photo taken before the recognition quota ran out', () => {
  it('keeps the local photo next to the request and uses it as the optimistic picture', () => {
    const vars = buildConfirmVariables([{ fields, draftId: null, photoUri: 'file:///shot.jpg' }]);
    const [item] = vars.request.items;
    expect(item).toBeDefined();
    if (!item) return;
    expect(vars.photos).toEqual({ [item.id]: 'file:///shot.jpg' });
    expect(vars.previews[item.id]).toBe('file:///shot.jpg');
    // The key is only known once the photo is uploaded, at send time.
    expect(item).not.toHaveProperty('photoKey');
    expect(item.draftId).toBeNull();
  });

  it('adds nothing for pieces without a photo, and ignores a photo next to an AI draft', () => {
    const plain = buildConfirmVariables([{ fields, draftId: null }]);
    expect(plain.photos).toBeUndefined();
    const withDraft = buildConfirmVariables([{ fields, draftId: 'draft_1', photoUri: 'file:///shot.jpg', preview: 'https://cdn/clean.jpg' }]);
    expect(withDraft.photos).toBeUndefined();
    expect(Object.values(withDraft.previews)).toEqual(['https://cdn/clean.jpg']);
  });

  it('sends the photo key with the confirm request and the piece is saved with that picture', async () => {
    const vars = buildConfirmVariables([
      { fields, draftId: null, photoUri: 'file:///shot.jpg' },
      { fields: { ...fields, name: 'Fotoğrafsız parça', useOriginalImage: false }, draftId: null },
    ]);
    const request = await withManualPhotos(vars);
    expect(request.items[0]?.photoKey).toBe('file:///shot.jpg');
    expect(request.items[1]).not.toHaveProperty('photoKey');
    // The original request is not mutated: a retried write uploads again and gets a fresh key.
    expect(vars.request.items[0]).not.toHaveProperty('photoKey');

    const before = fixtureDb.items.length;
    const saved = fixtureConfirmDrafts(request);
    expect(fixtureDb.items).toHaveLength(before + 2);
    expect(saved.items[0]).toMatchObject({ name: 'Keten gömlek', imageUrl: 'file:///shot.jpg', originalImageUrl: 'file:///shot.jpg', useOriginalImage: true });
    expect(saved.items[1]).toMatchObject({ name: 'Fotoğrafsız parça', imageUrl: null, originalImageUrl: null });
  });

  it('leaves a request without photos untouched', async () => {
    const vars = buildConfirmVariables([{ fields, draftId: null }]);
    await expect(withManualPhotos(vars)).resolves.toBe(vars.request);
  });
});

describe('camera state of the in-app viewfinder (12)', () => {
  it('maps the permission to what the frame shows', () => {
    expect(cameraStateOf(null, false)).toBe('checking');
    expect(cameraStateOf({ granted: false, canAskAgain: true }, false)).toBe('ask');
    expect(cameraStateOf({ granted: false, canAskAgain: false }, false)).toBe('denied');
    expect(cameraStateOf({ granted: true, canAskAgain: true }, false)).toBe('live');
  });

  it('a device without a camera wins over any permission', () => {
    expect(cameraStateOf({ granted: true, canAskAgain: true }, true)).toBe('unavailable');
    expect(cameraStateOf(null, true)).toBe('unavailable');
  });
});
