/**
 * "Önce üzerimde dene" or "Parçalarına ayır" — the choice offered as soon as a photo is picked from the gallery or
 * shared into the app (canvas 12+ / 16g), before anything is uploaded and before any AI call. The app cannot tell a
 * worn outfit from a flat-lay without AI, so both options are there with neutral wording; a gallery pick or a shared
 * image is usually an outfit photo, so trying on is highlighted. A shot on the camera of 12 is usually a single
 * garment: it skips the choice and goes straight to recognition (canvas n_ux1 A1).
 */
export type TryFirstEntry = 'camera' | 'gallery' | 'share';
export type TryFirstChoice = 'tryOn' | 'split';

/** Whether a photo from this entry first asks "Bu fotoğrafla ne yapalım?" (gallery, share) or is split at once (camera). */
export function asksFirst(entry: TryFirstEntry): boolean {
  return entry !== 'camera';
}

export function highlightedChoice(entry: TryFirstEntry): TryFirstChoice {
  return entry === 'camera' ? 'split' : 'tryOn';
}

/** The two options in display order: the highlighted one first. */
export function choiceOrder(entry: TryFirstEntry): [TryFirstChoice, TryFirstChoice] {
  return highlightedChoice(entry) === 'tryOn' ? ['tryOn', 'split'] : ['split', 'tryOn'];
}

/**
 * What a choice opens:
 * - `detect`: the existing recognition flow (12 → 12c / Parçaları seç);
 * - `explainer`: 16d, the first time a user tries an outfit photo on (then the credit confirmation from there);
 * - `confirm`: straight to the requirements and the credit confirmation over the photo (16d′).
 */
export type TryFirstStep = 'detect' | 'explainer' | 'confirm';

export function tryFirstStep(choice: TryFirstChoice, explainerSeen: boolean): TryFirstStep {
  if (choice === 'split') return 'detect';
  return explainerSeen ? 'confirm' : 'explainer';
}
