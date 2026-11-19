import type { LookSlotKind } from './looks';
import type { ItemCategory, ItemColor } from './wardrobe';

/**
 * "Kombinlerini içe aktar" (canvas 14a, 31–31e; docs/api/outfit-import.md). The user picks outfit photos;
 * the server finds the pieces of each, matches them with the wardrobe ("Gardırobunda var") or marks them new
 * ("Yeni", one piece however many photos show it) and drafts one look per photo for the user to approve.
 */

/** match = an existing wardrobe item · new = created on approval (when kept). */
export type ImportPieceKind = 'match' | 'new';

export type ImportPiece = {
  /** Commit reference of this piece in this photo ("3-2"). */
  ref: string;
  kind: ImportPieceKind;
  itemId: string | null;
  /** New pieces: the same id in every photo that shows the piece. */
  pieceId: string | null;
  name: string | null;
  category: ItemCategory;
  color: ItemColor;
  /** Its place in the look; null = saved as a wardrobe item only. */
  slot: LookSlotKind | null;
  imageUrl: string | null;
  /** Other photos that show the same new piece ("Foto 4 ve 7'de de var"). */
  alsoIn: number[];
};

/** pending = not uploaded yet · uploaded / detected = being processed · ready · failed. */
export type ImportPhotoStatus = 'pending' | 'uploaded' | 'detected' | 'ready' | 'failed';

export type ImportPhoto = {
  /** 1-based photo number. */
  index: number;
  status: ImportPhotoStatus;
  /** guardRejected = no piece found · sourceDeleted · providerError. */
  failure: string | null;
  imageUrl: string | null;
  lookId: string;
  pieces: ImportPiece[];
};

export type ImportStatus = 'uploading' | 'processing' | 'ready' | 'failed' | 'committed';

export type ImportCommitResult = {
  createdLookCount: number;
  createdItemCount: number;
  cleanupJobCount: number;
  looks: { photoIndex: number; outcome: 'created' | 'skipped'; code: string | null; lookId: string | null }[];
};

export type ImportSession = {
  id: string;
  status: ImportStatus;
  count: number;
  requested: number;
  counters: { uploaded: number; detected: number; matched: number; ready: number; failed: number };
  photos: ImportPhoto[];
  newPieceCount: number;
  matchedPieceCount: number;
  result: ImportCommitResult | null;
};

/** Presigned POST of one photo slot (the file is sent last, `image/jpeg`). */
export type ImportUpload = { index: number; url: string; fields: Record<string, string>; expiresAt: string; maxBytes: number };

export type ImportCreated = {
  session: ImportSession;
  uploads: ImportUpload[];
  /** Picked photos beyond a non-member's remaining recognitions (no slot). */
  skipped: number;
  /** The plan's photo limit (server configuration). */
  maxPhotos: number;
};

/** The user's choices on 31c: looks switched off, pieces unticked (by ref). Everything else is approved. */
export type ImportChoices = { looksOff: number[]; piecesOff: string[] };
