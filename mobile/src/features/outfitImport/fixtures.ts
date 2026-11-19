import type { ImportChoices, ImportCreated, ImportPhoto, ImportPiece, ImportSession } from '@/api/contracts/outfitImport';
import { clone, fixtureDb, onFixtureSeed } from '@/fixtures/db';

/**
 * Fixture server of "Kombinlerini içe aktar" (tests and the showcase build): a session whose photos become ready as
 * soon as they are "uploaded", with one piece from the wardrobe and one new piece shared by every photo (the
 * de-duplicated case).
 */
const sessions = new Map<string, ImportSession>();

onFixtureSeed(() => sessions.clear());

const NEW_SHIRT = 'piece_white_shirt';

function piecesFor(index: number): ImportPiece[] {
  const own = fixtureDb.items[index % Math.max(1, fixtureDb.items.length)];
  const pieces: ImportPiece[] = [];
  if (own) {
    pieces.push({
      ref: `${index}-1`, kind: 'match', itemId: own.id, pieceId: null, name: own.name, category: own.category, color: own.color,
      slot: own.category === 'bottom' ? 'bottom' : own.category === 'shoes' ? 'shoes' : own.category === 'outerwear' ? 'outerwear' : own.category === 'bag' || own.category === 'accessory' ? 'accessory' : own.category === 'top' || own.category === 'dress' ? 'top' : null,
      imageUrl: own.imageUrl ?? null, alsoIn: [],
    });
  }
  pieces.push({
    ref: `${index}-2`, kind: 'new', itemId: null, pieceId: NEW_SHIRT, name: 'Beyaz poplin gömlek', category: 'top', color: 'white',
    slot: pieces.some((p) => p.slot === 'top') ? null : 'top', imageUrl: null, alsoIn: [],
  });
  pieces.push({
    ref: `${index}-3`, kind: 'new', itemId: null, pieceId: `piece_jeans_${index}`, name: 'Düz jean', category: 'bottom', color: 'blue',
    slot: pieces.some((p) => p.slot === 'bottom') ? null : 'bottom', imageUrl: null, alsoIn: [],
  });
  return pieces;
}

function refresh(session: ImportSession): ImportSession {
  const shirtIn = session.photos.filter((p) => p.status === 'ready').map((p) => p.index);
  session.photos = session.photos.map((p) => ({ ...p, pieces: p.pieces.map((piece) => (piece.pieceId === NEW_SHIRT ? { ...piece, alsoIn: shirtIn.filter((i) => i !== p.index) } : piece)) }));
  const ready = session.photos.filter((p) => p.status === 'ready').length;
  const failed = session.photos.filter((p) => p.status === 'failed').length;
  const uploaded = session.photos.filter((p) => p.status !== 'pending').length;
  session.counters = { uploaded, detected: ready, matched: ready, ready, failed };
  const inFlight = session.photos.some((p) => p.status === 'uploaded' || p.status === 'detected');
  if (session.status !== 'committed') session.status = inFlight ? 'processing' : ready > 0 ? 'ready' : uploaded === 0 ? 'uploading' : 'failed';
  const all = session.photos.flatMap((p) => p.pieces);
  session.newPieceCount = new Set(all.filter((p) => p.kind === 'new').map((p) => p.pieceId)).size;
  session.matchedPieceCount = new Set(all.filter((p) => p.kind === 'match').map((p) => p.itemId)).size;
  return session;
}

export function fixtureCreateImport(requestId: string, count: number): ImportCreated {
  const quota = fixtureDb.entitlement.itemRecognition;
  const granted = quota?.remaining === null || quota?.remaining === undefined ? count : Math.min(count, quota.remaining);
  const existing = sessions.get(requestId);
  const session: ImportSession = existing ?? {
    id: requestId, status: 'uploading', count: granted, requested: count,
    counters: { uploaded: 0, detected: 0, matched: 0, ready: 0, failed: 0 },
    photos: Array.from({ length: granted }, (_, i): ImportPhoto => ({ index: i + 1, status: 'pending', failure: null, imageUrl: null, lookId: `look_import_${i + 1}`, pieces: [] })),
    newPieceCount: 0, matchedPieceCount: 0, result: null,
  };
  sessions.set(requestId, session);
  return clone({
    session,
    uploads: session.photos.filter((p) => p.status === 'pending').map((p) => ({ index: p.index, url: 'https://s3.test', fields: {}, expiresAt: new Date(Date.now() + 900_000).toISOString(), maxBytes: 10_485_760 })),
    skipped: count - session.count,
    maxPhotos: 30,
  });
}

export function fixtureMarkUploaded(sessionId: string, index: number): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.photos = session.photos.map((p) => (p.index === index && p.status === 'pending' ? { ...p, status: 'ready', pieces: piecesFor(index) } : p));
  refresh(session);
}

export function fixtureGetImport(sessionId: string): ImportSession | null {
  const session = sessions.get(sessionId);
  return session ? clone(refresh(session)) : null;
}

export function fixtureOpenImports(): ImportSession[] {
  return [...sessions.values()].filter((s) => s.status !== 'committed').map((s) => clone(refresh(s)));
}

export function fixtureCommitImport(sessionId: string, choices: ImportChoices): ImportSession | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  const kept = session.photos.filter((p) => p.status === 'ready' && !choices.looksOff.includes(p.index));
  const newPieces = new Set(kept.flatMap((p) => p.pieces.filter((x) => x.kind === 'new' && !choices.piecesOff.includes(x.ref)).map((x) => x.pieceId)));
  session.status = 'committed';
  session.result = {
    createdLookCount: kept.length, createdItemCount: newPieces.size, cleanupJobCount: newPieces.size,
    looks: session.photos.filter((p) => p.status === 'ready').map((p) => ({ photoIndex: p.index, outcome: kept.includes(p) ? 'created' : 'skipped', code: kept.includes(p) ? null : 'not_kept', lookId: kept.includes(p) ? p.lookId : null })),
  };
  return clone(session);
}

export function fixtureDiscardImport(sessionId: string): void {
  sessions.delete(sessionId);
}

/** Tests: a photo that gave no piece. */
export function fixtureFailPhoto(sessionId: string, index: number): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.photos = session.photos.map((p) => (p.index === index ? { ...p, status: 'failed', failure: 'guardRejected', pieces: [] } : p));
  refresh(session);
}
