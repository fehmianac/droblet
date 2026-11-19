import type { ItemDraft } from '@/api/contracts/wardrobe';

/**
 * 13 Toplu ekle — what each processing row shows before the real result arrives (canvas
 * `TopluEkleIsleniyor`): a progress that eases toward 90 % and only completes on the result, the
 * photo the user picked (blurred) until the cleaned image exists, and the header bar as the rows' average.
 */

/** Simulated progress never passes this: the last stretch is the real result. */
export const SIMULATED_CAP = 0.9;
/** Time constant of the ease: ~63 % of the cap after 12 s, ~86 % after 24 s. */
export const SIMULATED_TAU_MS = 12_000;

/** Ease-out toward `SIMULATED_CAP`: fast at first, slower and slower, never "done" on its own. */
export function simulatedProgress(elapsedMs: number): number {
  if (!(elapsedMs > 0)) return 0;
  return SIMULATED_CAP * (1 - Math.exp(-elapsedMs / SIMULATED_TAU_MS));
}

/** When this session first saw each draft processing (drafts carry no timestamp). */
const firstSeen = new Map<string, number>();

/**
 * First time `id` was seen (recorded at the real current time when new, so a stale render clock never
 * makes a new row jump ahead): rows keep their progress across re-renders and screens.
 */
export function seenSince(id: string, clock: () => number = Date.now): number {
  const at = firstSeen.get(id);
  if (at !== undefined) return at;
  const t = clock();
  firstSeen.set(id, t);
  return t;
}

/** A finished row (ready or failed) is complete; a processing row eases toward the cap. */
export function rowProgress(draft: Pick<ItemDraft, 'id' | 'status'>, now: number): number {
  if (draft.status === 'ready' || draft.status === 'failed') return 1;
  return simulatedProgress(now - seenSince(draft.id));
}

/** The header bar: the average of the rows, so it always agrees with them. */
export function overallProgress(drafts: Pick<ItemDraft, 'id' | 'status'>[], now: number): number {
  if (drafts.length === 0) return 0;
  return drafts.reduce((sum, d) => sum + rowProgress(d, now), 0) / drafts.length;
}

/** The picked photo on this device, by the draft it became: shown blurred until the cleaned image arrives. */
const localPreviews = new Map<string, string>();

/** Remembers which local photo became which draft (the API answers the ids in the order of the photos). */
export function rememberLocalPreviews(draftIds: string[], localUris: string[]): void {
  if (draftIds.length !== localUris.length) return;
  draftIds.forEach((id, i) => {
    const uri = localUris[i];
    if (uri) localPreviews.set(id, uri);
  });
}

/** The picture behind a processing row: the local pick, else the uploaded original (a piece's crop). */
export function processingPreview(draft: Pick<ItemDraft, 'id' | 'groupId' | 'imageUrl' | 'originalImageUrl'>): string | null {
  return localPreviews.get(draft.id) ?? draft.originalImageUrl ?? draft.imageUrl ?? null;
}

/** Drafts this session saw processing: when they turn ready the cleaned image fades in once. */
const sawProcessing = new Set<string>();
const revealed = new Set<string>();

export function markProcessing(id: string): void {
  sawProcessing.add(id);
}

/** A draft that was processing here and is now ready, not yet revealed: the cleaned image fades in once. */
export function shouldRevealClean(id: string): boolean {
  return sawProcessing.has(id) && !revealed.has(id);
}

export function markCleanRevealed(id: string): void {
  revealed.add(id);
}

/** Tests only. */
export function resetBulkRows(): void {
  firstSeen.clear();
  localPreviews.clear();
  sawProcessing.clear();
  revealed.clear();
}
