/**
 * "Önce üzerimde dene" or "Parçalarına ayır" — the choice offered as soon as a photo is picked (canvas 12+ / 16g),
 * before anything is uploaded and before any AI call. The app cannot tell a worn outfit from a flat-lay without AI,
 * so both options are always there with neutral wording; only which one is highlighted follows where the photo came
 * from (today's defaults): a shot on the camera of 12 is usually a single garment, a gallery pick or a shared image is
 * usually an outfit photo.
 */
export type TryFirstEntry = 'camera' | 'gallery' | 'share';
export type TryFirstChoice = 'tryOn' | 'split';

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
