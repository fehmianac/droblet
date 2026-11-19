import type { ImportPhoto, ImportPiece, ImportSession } from '@/api/contracts/outfitImport';
import { toImportSession, type ImportSessionWire } from '@/api/wire/outfitImport';
import { routeForPush } from '@/notify/routes';

import { commitBody, importProgress, NO_CHOICES, pickerLimit, reviewSummary, toggleLook, togglePiece } from './logic';

const piece = (ref: string, kind: 'match' | 'new', id: string, slot: ImportPiece['slot']): ImportPiece => ({
  ref, kind, itemId: kind === 'match' ? id : null, pieceId: kind === 'new' ? id : null, name: ref, category: 'top', color: 'white', slot, imageUrl: null, alsoIn: [],
});

const photo = (index: number, pieces: ImportPiece[], status: ImportPhoto['status'] = 'ready'): ImportPhoto => ({ index, status, failure: null, imageUrl: null, lookId: `l${index}`, pieces });

const session = (photos: ImportPhoto[]): ImportSession => ({
  id: 's', status: 'ready', count: photos.length, requested: photos.length, counters: { uploaded: 0, detected: 0, matched: 0, ready: 0, failed: 0 },
  photos, newPieceCount: 0, matchedPieceCount: 0, result: null,
});

const S = session([
  photo(1, [piece('1-1', 'match', 'blazer', 'outerwear'), piece('1-2', 'new', 'shirt', 'top'), piece('1-3', 'new', 'jeans', 'bottom')]),
  photo(2, [piece('2-1', 'new', 'shirt', 'top'), piece('2-2', 'new', 'shoes', 'shoes')]),
  photo(3, [piece('3-1', 'new', 'ring', null)]),
  photo(4, [], 'failed'),
]);

describe('pickerLimit', () => {
  it('is the plan limit, capped by the recognitions left of a non-member', () => {
    expect(pickerLimit(30, null)).toBe(30);
    expect(pickerLimit(30, 7)).toBe(7);
    expect(pickerLimit(12, 40)).toBe(12);
    expect(pickerLimit(30, 0)).toBe(0);
    expect(pickerLimit(null, 5)).toBe(5);
    expect(pickerLimit(null, null)).toBe(0);
  });
});

describe('review', () => {
  it('counts looks with two kept slot pieces and each new piece once', () => {
    expect(reviewSummary(S, NO_CHOICES)).toEqual({ looks: 2, newPieces: 4, matched: 1 });
    const noJeansNoPhoto2 = togglePiece(toggleLook(NO_CHOICES, 2), '1-3');
    expect(reviewSummary(S, noJeansNoPhoto2)).toEqual({ looks: 1, newPieces: 2, matched: 1 });
  });

  it('sends only what differs from "approve everything"', () => {
    expect(commitBody(S, NO_CHOICES)).toEqual({ looks: [] });
    const choices = togglePiece(toggleLook(NO_CHOICES, 2), '1-3');
    expect(commitBody(S, choices)).toEqual({
      looks: [
        { photoIndex: 1, keep: true, pieces: [{ ref: '1-3', keep: false }] },
        { photoIndex: 2, keep: false },
      ],
    });
    expect(toggleLook(toggleLook(NO_CHOICES, 2), 2)).toEqual(NO_CHOICES);
  });

  it('progress counts ready and failed photos', () => {
    expect(importProgress(S)).toEqual({ done: 4, total: 4 });
  });
});

describe('wire', () => {
  it('maps a session: slots, colours, kinds', () => {
    const wire: ImportSessionWire = {
      id: 's', status: 'ready', count: 1, requested: 1, counters: { uploaded: 1, detected: 1, matched: 1, ready: 1, failed: 0 },
      photos: [{ index: 1, status: 'ready', failure: null, imageUrl: 'https://x', lookId: 'l1', pieces: [
        { ref: '1-1', kind: 'new', itemId: null, pieceId: 'p', name: 'Çanta', category: 'bag', subcategory: 'tote', colorIds: ['black'], slot: 'bagAccessory', imageUrl: null, matchConfidence: null, alsoIn: [2] },
      ] }],
      newPieceCount: 1, matchedPieceCount: 0, createdAt: '', expiresAt: '', imageUrlExpiresAt: null, result: null,
    };
    const mapped = toImportSession(wire);
    expect(mapped.photos[0]?.pieces[0]).toMatchObject({ slot: 'accessory', color: 'black', kind: 'new', alsoIn: [2] });
  });

  it('routes the "ready" inbox row to the review', () => {
    expect(routeForPush({ type: 'outfit_import_ready', sessionId: '01JSESSION' })).toEqual({ pathname: '/import/[id]', params: { id: '01JSESSION' } });
    expect(routeForPush({ type: 'outfit_import_ready' })).toBe('/import');
  });
});
