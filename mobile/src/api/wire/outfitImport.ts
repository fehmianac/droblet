import type { ImportCommitResult, ImportCreated, ImportPhoto, ImportPiece, ImportSession, ImportStatus, ImportUpload } from '../contracts/outfitImport';
import type { ItemCategory } from '../contracts/wardrobe';
import { toItemColor, toSlotKind, type OutfitSlotWire } from './wardrobe';

/** Wire shapes of `v1/tenant/outfit-import` (docs/api/outfit-import.md, `src/Api/Endpoints/V1/Tenant/OutfitImport`). */
export type ImportPieceWire = {
  ref: string;
  kind: 'match' | 'new';
  itemId: string | null;
  pieceId: string | null;
  name: string | null;
  category: ItemCategory;
  subcategory: string | null;
  colorIds: string[];
  slot: OutfitSlotWire | null;
  imageUrl: string | null;
  matchConfidence: number | null;
  alsoIn: number[];
};

export type ImportPhotoWire = {
  index: number;
  status: ImportPhoto['status'];
  failure: string | null;
  imageUrl: string | null;
  lookId: string;
  pieces: ImportPieceWire[];
};

export type ImportCommitResultWire = {
  looks: { photoIndex: number; outcome: 'created' | 'skipped'; code: string | null; lookId: string | null }[];
  items: { pieceId: string; outcome: string; code: string | null; itemId: string | null }[];
  createdLookCount: number;
  createdItemCount: number;
  cleanupJobCount: number;
};

export type ImportSessionWire = {
  id: string;
  status: ImportStatus;
  count: number;
  requested: number;
  counters: { uploaded: number; detected: number; matched: number; ready: number; failed: number };
  photos: ImportPhotoWire[];
  newPieceCount: number;
  matchedPieceCount: number;
  createdAt: string;
  expiresAt: string;
  imageUrlExpiresAt: string | null;
  result: ImportCommitResultWire | null;
};

export type ImportCreatedWire = {
  session: ImportSessionWire;
  uploads: ImportUpload[];
  skipped: number;
  maxPhotos: number;
  itemRecognition: { limit: number | null; used: number; remaining: number | null };
};

/** POST v1/tenant/outfit-import/{id}/commit — a photo or piece left out is kept. */
export type ImportCommitWire = {
  looks: { photoIndex: number; keep: boolean; pieces?: { ref: string; keep: boolean }[] }[];
};

export function toImportPiece(wire: ImportPieceWire): ImportPiece {
  return {
    ref: wire.ref,
    kind: wire.kind,
    itemId: wire.itemId,
    pieceId: wire.pieceId,
    name: wire.name,
    category: wire.category,
    color: toItemColor(wire.colorIds[0]),
    slot: wire.slot ? toSlotKind(wire.slot) : null,
    imageUrl: wire.imageUrl,
    alsoIn: wire.alsoIn,
  };
}

export function toImportResult(wire: ImportCommitResultWire): ImportCommitResult {
  return { createdLookCount: wire.createdLookCount, createdItemCount: wire.createdItemCount, cleanupJobCount: wire.cleanupJobCount, looks: wire.looks };
}

export function toImportSession(wire: ImportSessionWire): ImportSession {
  return {
    id: wire.id,
    status: wire.status,
    count: wire.count,
    requested: wire.requested,
    counters: wire.counters,
    photos: wire.photos.map((p) => ({ index: p.index, status: p.status, failure: p.failure, imageUrl: p.imageUrl, lookId: p.lookId, pieces: p.pieces.map(toImportPiece) })),
    newPieceCount: wire.newPieceCount,
    matchedPieceCount: wire.matchedPieceCount,
    result: wire.result ? toImportResult(wire.result) : null,
  };
}

export function toImportCreated(wire: ImportCreatedWire): ImportCreated {
  return { session: toImportSession(wire.session), uploads: wire.uploads, skipped: wire.skipped, maxPhotos: wire.maxPhotos };
}
