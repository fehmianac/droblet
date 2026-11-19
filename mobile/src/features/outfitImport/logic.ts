import type { ImportChoices, ImportPhoto, ImportSession } from '@/api/contracts/outfitImport';
import type { ImportCommitWire } from '@/api/wire/outfitImport';

/** Long edge of an imported photo on the device (the server's detection needs no more; less to upload). */
export const IMPORT_MAX_EDGE = 1600;

/**
 * How many photos the picker may take: the plan's limit (server value, `outfitImport.maxPhotos`), and for a
 * non-member no more than the AI recognitions left (each photo uses one). Null limit / remaining = no cap
 * known on the device: the server value of the session answer decides.
 */
export function pickerLimit(maxPhotos: number | null, remaining: number | null): number {
  const plan = maxPhotos !== null && maxPhotos > 0 ? maxPhotos : null;
  if (plan === null && remaining === null) return 0;
  if (plan === null) return Math.max(0, remaining ?? 0);
  return remaining === null ? plan : Math.max(0, Math.min(plan, remaining));
}

export const isLookOn = (choices: ImportChoices, photo: number) => !choices.looksOff.includes(photo);
export const isPieceOn = (choices: ImportChoices, ref: string) => !choices.piecesOff.includes(ref);

export function toggleLook(choices: ImportChoices, photo: number): ImportChoices {
  return isLookOn(choices, photo)
    ? { ...choices, looksOff: [...choices.looksOff, photo] }
    : { ...choices, looksOff: choices.looksOff.filter((p) => p !== photo) };
}

export function togglePiece(choices: ImportChoices, ref: string): ImportChoices {
  return isPieceOn(choices, ref)
    ? { ...choices, piecesOff: [...choices.piecesOff, ref] }
    : { ...choices, piecesOff: choices.piecesOff.filter((r) => r !== ref) };
}

/** "Tümünü seç": every look and piece back on. */
export const NO_CHOICES: ImportChoices = { looksOff: [], piecesOff: [] };

export const readyPhotos = (session: ImportSession): ImportPhoto[] => session.photos.filter((p) => p.status === 'ready');

/**
 * What "Onayla" creates, counted the way the server does: a kept look needs two kept pieces (one per slot);
 * a new piece is created once, when it is kept in at least one kept look; matched pieces are not counted.
 */
export function reviewSummary(session: ImportSession, choices: ImportChoices): { looks: number; newPieces: number; matched: number } {
  const newPieces = new Set<string>();
  const matched = new Set<string>();
  let looks = 0;
  for (const photo of readyPhotos(session)) {
    if (!isLookOn(choices, photo.index)) continue;
    const kept = photo.pieces.filter((p) => isPieceOn(choices, p.ref));
    const slots = new Set(kept.map((p) => p.slot).filter((s) => s !== null));
    if (slots.size >= 2) looks++;
    for (const piece of kept) {
      if (piece.kind === 'new' && piece.pieceId) newPieces.add(piece.pieceId);
      if (piece.kind === 'match' && piece.itemId) matched.add(piece.itemId);
    }
  }
  return { looks, newPieces: newPieces.size, matched: matched.size };
}

/** Only what differs from "approve everything" goes on the wire (a photo or piece left out is kept). */
export function commitBody(session: ImportSession, choices: ImportChoices): ImportCommitWire {
  const looks: ImportCommitWire['looks'] = [];
  for (const photo of readyPhotos(session)) {
    if (!isLookOn(choices, photo.index)) {
      looks.push({ photoIndex: photo.index, keep: false });
      continue;
    }
    const off = photo.pieces.filter((p) => !isPieceOn(choices, p.ref)).map((p) => ({ ref: p.ref, keep: false }));
    if (off.length > 0) looks.push({ photoIndex: photo.index, keep: true, pieces: off });
  }
  return { looks };
}

/** 31b progress: photos done (ready or failed) of those the session holds. */
export function importProgress(session: ImportSession): { done: number; total: number } {
  const total = session.photos.length;
  const done = session.photos.filter((p) => p.status === 'ready' || p.status === 'failed').length;
  return { done, total };
}

/** The photos to show on 31c, ready ones first in photo order, then the ones without pieces. */
export function reviewPhotos(session: ImportSession): ImportPhoto[] {
  return [...readyPhotos(session), ...session.photos.filter((p) => p.status === 'failed')];
}
