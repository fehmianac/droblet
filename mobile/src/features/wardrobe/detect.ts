/**
 * "Fotoğrafta N parça bulduk" — the rules of the multi-item chooser, kept free of React so they are tested
 * on their own. One AI recognition finds every piece in a photo; with two or more pieces the photo becomes
 * a group and the user picks which pieces to keep. Nothing costs an image-model call before that choice.
 */
import { useSyncExternalStore } from 'react';

import type { ItemDraft, ItemFields } from '@/api/contracts/wardrobe';

/** Below this the box itself is doubtful: the piece starts unticked with "Kontrol et" (server threshold: 0.7). */
export const LOW_CONFIDENCE = 0.7;

export type ChooserState =
  /** The draft list does not have the photo (deleted, or already confirmed). */
  | 'missing'
  /** The photo is still being analysed: "Parçalar ayırt ediliyor…". */
  | 'processing'
  /** The AI found no piece: "Bu fotoğrafta parça bulamadık" — retry or manual entry. */
  | 'empty'
  /** The analysis failed for another reason (provider, timeout). */
  | 'failed'
  /** Exactly one piece: no chooser, straight to the review form (12c). */
  | 'single'
  /** Two or more pieces wait for the user's choice. */
  | 'choose'
  /** The choice was made already: the kept pieces are in the review list (13). */
  | 'done';

type Draft = Pick<ItemDraft, 'id' | 'status' | 'kind' | 'groupId' | 'index' | 'confidence' | 'lowConfidence' | 'failure'>;

/** A piece the model was unsure about — its category or its box. */
export function isLowConfidence(piece: Pick<ItemDraft, 'lowConfidence' | 'confidence'>): boolean {
  return piece.lowConfidence.includes('category') || (piece.confidence ?? 1) < LOW_CONFIDENCE;
}

/** Drafts the review list (13) shows as rows: not a group photo, not a piece still waiting for the chooser. */
export function isReviewable(draft: Pick<ItemDraft, 'kind' | 'status'>): boolean {
  return draft.kind !== 'group' && draft.status !== 'detected';
}

/** Group photos whose pieces still wait for a choice (13 shows them as "N parça bulundu · Seç" cards). */
export function pendingGroups<T extends Draft>(drafts: T[]): T[] {
  return drafts.filter((d) => d.kind === 'group' && detectedPieces(drafts, d.id).length > 0);
}

/** The pieces of a group still waiting for the user's choice, by their number. */
export function detectedPieces<T extends Draft>(drafts: T[], groupId: string): T[] {
  return drafts.filter((d) => d.kind === 'piece' && d.groupId === groupId && d.status === 'detected').sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

export function chooserState(drafts: Draft[], draftId: string): ChooserState {
  const source = drafts.find((d) => d.id === draftId);
  if (!source) return 'missing';
  if (source.status === 'processing') return 'processing';
  if (source.status === 'failed') return source.failure === 'guardRejected' ? 'empty' : 'failed';
  if (source.kind === 'group') return detectedPieces(drafts, source.id).length > 0 ? 'choose' : 'done';
  return 'single';
}

/** Ticked when the chooser opens: every piece except the doubtful ones. */
export function defaultSelection(pieces: Pick<ItemDraft, 'id' | 'lowConfidence' | 'confidence'>[]): Set<string> {
  return new Set(pieces.filter((p) => !isLowConfidence(p)).map((p) => p.id));
}

/** "Tümünü seç" ticks every piece (the doubtful ones too: the user asked for all); "Hiçbirini" none. */
export function selectAll(pieces: Pick<ItemDraft, 'id'>[], all: boolean): Set<string> {
  return all ? new Set(pieces.map((p) => p.id)) : new Set();
}

export function toggle(selection: Set<string>, id: string): Set<string> {
  const next = new Set(selection);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * What is ticked: the user's own taps (`overrides`) win; otherwise a piece edited in 12c counts as chosen,
 * and the rest follows `defaultSelection`.
 */
export function resolveSelection(
  pieces: Pick<ItemDraft, 'id' | 'lowConfidence' | 'confidence'>[],
  overrides: Record<string, boolean>,
  edited: Set<string>,
): Set<string> {
  const base = defaultSelection(pieces);
  return new Set(pieces.filter((p) => overrides[p.id] ?? (edited.has(p.id) || base.has(p.id))).map((p) => p.id));
}

/** The ticked ids in the pieces' order (what `POST item-draft/{id}/select` gets). */
export function selectedIds(pieces: Pick<ItemDraft, 'id'>[], selection: Set<string>): string[] {
  return pieces.filter((p) => selection.has(p.id)).map((p) => p.id);
}

// ---------- edits made in the form (12c) before a piece is selected ----------

/**
 * Values the user typed for a detected piece in 12c, kept until "N parçayı ekle" sends them with the
 * selection (`edits`). In memory only: an edit the user never sent is not worth keeping across restarts.
 */
const edits = new Map<string, ItemFields>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version += 1;
  listeners.forEach((l) => l());
}

export const detectedEdits = {
  get: (draftId: string): ItemFields | undefined => edits.get(draftId),
  set: (draftId: string, fields: ItemFields) => {
    edits.set(draftId, fields);
    emit();
  },
  /** After the selection was sent (or the group dropped). */
  clear: (draftIds: string[]) => {
    draftIds.forEach((id) => edits.delete(id));
    emit();
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** Re-renders when an edit is saved; returns a counter so callers can depend on it. */
export function useDetectedEditsVersion(): number {
  return useSyncExternalStore(detectedEdits.subscribe, () => version);
}
