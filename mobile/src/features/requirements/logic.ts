import type { BodyType } from '@/api/contracts';
import { CONSENTS_FOR, type ConsentType } from '@/api/contracts/consents';

/**
 * Canvas 11 "Eksik adım tamamlama" — what an action still needs, computed on the device from data the app
 * already has (profile, photos, consents, entitlement, city, handle, age). Pure: `useRequirements` feeds it.
 *
 * Rules (canvas note n_eksik_kural):
 *  - a button never silently does nothing: the missing steps are said in advance (hint) and opened on tap;
 *  - order 18+ → consent → photo → membership / credits;
 *  - a missing full-length photo is a path, not a wall: the face photo + body type path is offered;
 *  - an unknown value (still loading, offline) never blocks — the server is the safety net.
 */
export type RequirementAction = 'tryOn' | 'palette' | 'stylist' | 'week' | 'pack' | 'social' | 'contacts';

export type PhotoPath = 'body' | 'face';

export type StepKind = 'age' | 'consent' | 'bodyPhoto' | 'facePhoto' | 'bodyType' | 'premium' | 'credits' | 'city' | 'handle';

export type RequirementStep = {
  kind: StepKind;
  /** `consent` only: the types to ask for (each its own box). */
  consents?: ConsentType[];
  /** The step can be passed without completing it ("Şehirsiz devam et"). */
  optional?: boolean;
};

export type RequirementInput = {
  /** False only for an Apple / Google account that has not confirmed 18+. */
  ageConfirmed: boolean | null;
  /** Consent types whose record is valid; null = not known yet. */
  validConsents: readonly ConsentType[] | null;
  hasBodyPhoto: boolean | null;
  hasFacePhoto: boolean | null;
  /** Null = not chosen; undefined = not known yet. */
  bodyType: BodyType | null | undefined;
  /** A body profile (height + size) exists; null = not known. */
  hasBodyProfile: boolean | null;
  isMember: boolean | null;
  creditsRemaining: number | null;
  /** Null = no city; undefined = not known yet. */
  cityId: string | null | undefined;
  /** Null = no @handle; undefined = not known yet. */
  handle: string | null | undefined;
  itemCount: number | null;
  /** The user chose "Şehirsiz devam et" in this session. */
  cityDeclined?: boolean;
  /** False while the e-mail of an e-mail sign-up is not verified; true / undefined otherwise (nothing to do). */
  emailVerified?: boolean;
  /** Approved teen: the stylist / week plan / packing run on the free-tier `Teen:Stylist` allowance (no membership step). */
  teenStylist?: boolean;
};

export type Requirements = {
  action: RequirementAction;
  /** In order. Empty = the action can run. */
  steps: RequirementStep[];
  /** Try-on only: which photo path the steps are for (null when a photo is not the question). */
  path: PhotoPath | null;
  /** Try-on only: no usable photo yet — the sheet offers the two-choice photo step. */
  choosePath: boolean;
  /** What the one-line hint names (the first missing thing); null when nothing is missing. */
  hint: StepKind | null;
  count: number;
  ready: boolean;
};

/** Image credits one try-on costs (README §9.1). */
const TRY_ON_COST = 1;

function missingConsents(input: RequirementInput, types: readonly ConsentType[]): ConsentType[] {
  if (input.validConsents === null) return [];
  return types.filter((type) => !input.validConsents?.includes(type));
}

function consentStep(input: RequirementInput, types: readonly ConsentType[]): RequirementStep[] {
  const missing = missingConsents(input, types);
  return missing.length > 0 ? [{ kind: 'consent', consents: missing }] : [];
}

function ageStep(input: RequirementInput): RequirementStep[] {
  return input.ageConfirmed === false ? [{ kind: 'age' }] : [];
}

function premiumStep(input: RequirementInput): RequirementStep[] {
  return input.isMember === false ? [{ kind: 'premium' }] : [];
}

/** An approved teen's stylist runs on the free-tier allowance (`Teen:Stylist`): never the membership step (no paywall). */
function stylistPremiumStep(input: RequirementInput): RequirementStep[] {
  return input.teenStylist ? [] : premiumStep(input);
}

/** The steps of one photo path for "Üzerimde gör" (consent, photo, body type) — without 18+ and membership. */
export function photoPathSteps(input: RequirementInput, path: PhotoPath): RequirementStep[] {
  if (path === 'body') {
    return [...consentStep(input, CONSENTS_FOR.tryOn), ...(input.hasBodyPhoto === false ? [{ kind: 'bodyPhoto' as const }] : [])];
  }
  return [
    ...consentStep(input, CONSENTS_FOR.tryOnFace),
    ...(input.hasFacePhoto === false ? [{ kind: 'facePhoto' as const }] : []),
    // Height and size come with the body type (one screen) when there is no body profile yet.
    ...(input.bodyType === null || input.hasBodyProfile === false ? [{ kind: 'bodyType' as const }] : []),
  ];
}

/** Which path a try-on uses when nothing is chosen: the body photo when there is one, else the shorter way. */
export function defaultPath(input: RequirementInput): PhotoPath {
  if (input.hasBodyPhoto !== false) return 'body';
  return photoPathSteps(input, 'face').length < photoPathSteps(input, 'body').length ? 'face' : 'body';
}

function tryOn(input: RequirementInput, preferred: PhotoPath | null): Omit<Requirements, 'action' | 'hint' | 'count' | 'ready'> {
  const age = ageStep(input);
  const tail: RequirementStep[] = [
    ...premiumStep(input),
    ...(input.isMember === true && input.creditsRemaining !== null && input.creditsRemaining < TRY_ON_COST ? [{ kind: 'credits' as const }] : []),
  ];
  // The server renders on the body photo whenever there is one.
  if (input.hasBodyPhoto !== false) {
    return { steps: [...age, ...(input.hasBodyPhoto ? photoPathSteps(input, 'body') : []), ...tail], path: input.hasBodyPhoto ? 'body' : null, choosePath: false };
  }
  const faceSteps = photoPathSteps(input, 'face');
  if (faceSteps.length === 0) return { steps: [...age, ...tail], path: 'face', choosePath: false };
  const path = preferred ?? defaultPath(input);
  return { steps: [...age, ...photoPathSteps(input, path), ...tail], path, choosePath: true };
}

export function computeRequirements(action: RequirementAction, input: RequirementInput, preferredPath: PhotoPath | null = null): Requirements {
  let steps: RequirementStep[] = [];
  let path: PhotoPath | null = null;
  let choosePath = false;
  switch (action) {
    case 'tryOn': {
      ({ steps, path, choosePath } = tryOn(input, preferredPath));
      break;
    }
    case 'palette':
      steps = [
        ...ageStep(input),
        ...consentStep(input, CONSENTS_FOR.palette),
        ...(input.hasFacePhoto === false ? [{ kind: 'facePhoto' as const }] : []),
        ...premiumStep(input),
      ];
      break;
    case 'stylist':
    case 'week':
      steps = [...ageStep(input), ...stylistPremiumStep(input), ...(input.cityId === null && !input.cityDeclined ? [{ kind: 'city' as const, optional: true }] : [])];
      break;
    case 'pack':
      steps = [...ageStep(input), ...stylistPremiumStep(input)];
      break;
    case 'social':
      steps = [...ageStep(input), ...(input.handle === null ? [{ kind: 'handle' as const }] : [])];
      break;
    case 'contacts':
      steps = [...ageStep(input), ...consentStep(input, CONSENTS_FOR.contacts)];
      break;
  }
  const first = steps[0]?.kind ?? null;
  // "Boy fotoğrafın gerekiyor" names the photo even when a consent comes first (canvas 11a).
  const photo = steps.find((s) => s.kind === 'bodyPhoto' || s.kind === 'facePhoto' || s.kind === 'bodyType')?.kind ?? null;
  const hint = first === 'consent' && photo ? photo : first;
  return { action, steps, path, choosePath, hint, count: steps.length, ready: steps.length === 0 };
}

/**
 * One item of "Profilini tamamla" as its own short flow (its consent first when needed). Empty when it is done.
 * `action` is only the frame's name ("Üzerimde gör" for photos and body type).
 */
export function singleStepRequirements(kind: 'bodyPhoto' | 'facePhoto' | 'bodyType' | 'city' | 'handle', input: RequirementInput): Requirements {
  let steps: RequirementStep[] = [];
  let action: RequirementAction = 'tryOn';
  switch (kind) {
    case 'bodyPhoto':
      steps = [...consentStep(input, CONSENTS_FOR.bodyPhoto), ...(input.hasBodyPhoto === true ? [] : [{ kind: 'bodyPhoto' as const }])];
      break;
    case 'facePhoto':
      steps = [...consentStep(input, CONSENTS_FOR.facePhoto), ...(input.hasFacePhoto === true ? [] : [{ kind: 'facePhoto' as const }])];
      break;
    case 'bodyType':
      steps = input.bodyType ? [] : [{ kind: 'bodyType' }];
      break;
    case 'city':
      action = 'stylist';
      steps = input.cityId ? [] : [{ kind: 'city', optional: true }];
      break;
    case 'handle':
      action = 'social';
      steps = input.handle ? [] : [{ kind: 'handle' }];
      break;
  }
  // A consent alone does not complete a photo item: keep the photo step even when the consent is the first.
  return { action, steps, path: null, choosePath: false, hint: steps[0]?.kind ?? null, count: steps.length, ready: steps.length === 0 };
}

// ── "Profilini tamamla" (Profil, Bugün) ──────────────────────────────────────────────────────────────────────────

export type ProfileItemKey = 'verifyEmail' | 'bodyPhoto' | 'facePhoto' | 'bodyType' | 'city' | 'handle' | 'firstItems';

export type ProfileItem = { key: ProfileItemKey; done: boolean };

/** Pieces after which "İlk 5 parça" counts as done. */
export const FIRST_ITEMS_TARGET = 5;

/**
 * The six items of the card, in the board's order; unknown values count as not done. "E-postanı doğrula" comes
 * first, and only while the address is unverified (it never blocks anything, so others never see a seventh item).
 */
/**
 * The "Profilini tamamla" items. Canvas 18: a teen has no @username (no social), and while the parent's approval is
 * missing the photo items are left out (they cannot be done yet).
 */
export function profileCompletion(input: RequirementInput, teen: { social: boolean; photos: boolean } = { social: true, photos: true }): ProfileItem[] {
  const items: ProfileItem[] = [
    ...(input.emailVerified === false ? [{ key: 'verifyEmail' as const, done: false }] : []),
    { key: 'bodyPhoto', done: input.hasBodyPhoto === true },
    { key: 'facePhoto', done: input.hasFacePhoto === true },
    { key: 'bodyType', done: Boolean(input.bodyType) },
    { key: 'city', done: Boolean(input.cityId) },
    { key: 'handle', done: Boolean(input.handle) },
    { key: 'firstItems', done: (input.itemCount ?? 0) >= FIRST_ITEMS_TARGET },
  ];
  return items.filter((i) => (teen.social || i.key !== 'handle') && (teen.photos || (i.key !== 'bodyPhoto' && i.key !== 'facePhoto')));
}

/** True while any input the card needs is still loading (it does not flash a wrong count). */
export function completionKnown(input: RequirementInput): boolean {
  return input.hasBodyPhoto !== null && input.bodyType !== undefined && input.cityId !== undefined && input.handle !== undefined && input.itemCount !== null;
}
