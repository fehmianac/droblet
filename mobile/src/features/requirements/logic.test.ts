import { CONSENT_TYPES } from '@/api/contracts/consents';

import { computeRequirements, defaultPath, profileCompletion, singleStepRequirements, type RequirementInput } from './logic';
import { handleSuggestions, HANDLE_RULE, normalizeHandle } from './steps/StepMisc';

/** A member with everything: nothing is missing anywhere. */
const complete: RequirementInput = {
  ageConfirmed: true,
  validConsents: [...CONSENT_TYPES],
  hasBodyPhoto: true,
  hasFacePhoto: true,
  bodyType: 'pear',
  hasBodyProfile: true,
  isMember: true,
  creditsRemaining: 12,
  cityId: '745044',
  handle: 'damla',
  itemCount: 12,
};
const kinds = (input: RequirementInput, action: Parameters<typeof computeRequirements>[0], path: 'body' | 'face' | null = null) =>
  computeRequirements(action, input, path).steps.map((s) => s.kind);

describe('computeRequirements (canvas 11 prerequisite table)', () => {
  it('nothing missing → ready, no hint, for every action', () => {
    for (const action of ['tryOn', 'palette', 'stylist', 'week', 'pack', 'social', 'contacts'] as const) {
      const req = computeRequirements(action, complete);
      expect(req).toMatchObject({ ready: true, count: 0, hint: null });
    }
  });

  it('try-on without a body photo: the two-choice photo step, body path = consent + photo (2 steps, hint names the photo)', () => {
    const input = { ...complete, hasBodyPhoto: false, hasFacePhoto: false, validConsents: [] };
    const req = computeRequirements('tryOn', input);
    expect(req.choosePath).toBe(true);
    expect(req.path).toBe('body');
    expect(req.steps).toEqual([{ kind: 'consent', consents: ['bodyPhotoAi', 'crossBorderTransfer'] }, { kind: 'bodyPhoto' }]);
    expect(req.hint).toBe('bodyPhoto');
    expect(req.count).toBe(2);
  });

  it('try-on face path: facePhotoTryOn + transfer, face photo, body type — in that order', () => {
    const input = { ...complete, hasBodyPhoto: false, hasFacePhoto: false, bodyType: null, validConsents: [] };
    expect(computeRequirements('tryOn', input, 'face').steps).toEqual([
      { kind: 'consent', consents: ['facePhotoTryOn', 'crossBorderTransfer'] },
      { kind: 'facePhoto' },
      { kind: 'bodyType' },
    ]);
  });

  it('the body path is recommended; the face path is the default only when it is shorter; a finished face path needs nothing', () => {
    const faceOnly = { ...complete, hasBodyPhoto: false, bodyType: null };
    expect(defaultPath(faceOnly)).toBe('body');
    expect(kinds(faceOnly, 'tryOn', 'face')).toEqual(['bodyType']);
    expect(defaultPath({ ...faceOnly, validConsents: ['facePhotoTryOn', 'crossBorderTransfer'] })).toBe('face');
    expect(computeRequirements('tryOn', { ...faceOnly, bodyType: 'unsure' })).toMatchObject({ ready: true, path: 'face', choosePath: false });
  });

  it('with a body photo the server uses it: only the body consents can be missing', () => {
    expect(kinds({ ...complete, validConsents: ['facePhotoTryOn', 'crossBorderTransfer'] }, 'tryOn')).toEqual(['consent']);
    expect(computeRequirements('tryOn', { ...complete, validConsents: ['crossBorderTransfer'] }).steps[0]?.consents).toEqual(['bodyPhotoAi']);
  });

  it('order 18+ → consent → photo → membership / credits', () => {
    const input = { ...complete, ageConfirmed: false, hasBodyPhoto: false, hasFacePhoto: false, validConsents: [], isMember: false };
    expect(kinds(input, 'tryOn')).toEqual(['age', 'consent', 'bodyPhoto', 'premium']);
    expect(kinds({ ...complete, creditsRemaining: 0 }, 'tryOn')).toEqual(['credits']);
  });

  it('unknown values never block (still loading / offline)', () => {
    const unknown: RequirementInput = {
      ageConfirmed: null,
      validConsents: null,
      hasBodyPhoto: null,
      hasFacePhoto: null,
      bodyType: undefined,
      hasBodyProfile: null,
      isMember: null,
      creditsRemaining: null,
      cityId: undefined,
      handle: undefined,
      itemCount: null,
    };
    for (const action of ['tryOn', 'palette', 'stylist', 'week', 'pack', 'social', 'contacts'] as const) expect(computeRequirements(action, unknown).ready).toBe(true);
  });

  it('palette, stylist / week, pack, social, contacts', () => {
    expect(kinds({ ...complete, hasFacePhoto: false, validConsents: ['bodyPhotoAi'], isMember: false }, 'palette')).toEqual(['consent', 'facePhoto', 'premium']);
    expect(kinds({ ...complete, isMember: false, cityId: null }, 'stylist')).toEqual(['premium', 'city']);
    expect(kinds({ ...complete, cityId: null, cityDeclined: true }, 'week')).toEqual([]);
    expect(kinds({ ...complete, isMember: false, cityId: null }, 'pack')).toEqual(['premium']);
    expect(kinds({ ...complete, handle: null }, 'social')).toEqual(['handle']);
    expect(computeRequirements('contacts', { ...complete, validConsents: [] }).steps).toEqual([{ kind: 'consent', consents: ['contacts'] }]);
  });

  it('single "Profilini tamamla" items: consent first, done items are empty', () => {
    expect(singleStepRequirements('facePhoto', { ...complete, hasFacePhoto: false, validConsents: [] }).steps.map((s) => s.kind)).toEqual(['consent', 'facePhoto']);
    expect(singleStepRequirements('bodyType', complete).ready).toBe(true);
    expect(singleStepRequirements('handle', { ...complete, handle: null }).action).toBe('social');
  });
});

describe('profileCompletion', () => {
  it('lists the six items in the board order and counts the done ones', () => {
    const items = profileCompletion({ ...complete, hasBodyPhoto: false, bodyType: null, itemCount: 3 });
    expect(items.map((i) => i.key)).toEqual(['bodyPhoto', 'facePhoto', 'bodyType', 'city', 'handle', 'firstItems']);
    expect(items.filter((i) => i.done).map((i) => i.key)).toEqual(['facePhoto', 'city', 'handle']);
  });
});

describe('handle rule (backend: 3–30, a-z 0-9 . _)', () => {
  it('accepts and refuses like the server', () => {
    expect(HANDLE_RULE.test('damla.k')).toBe(true);
    expect(HANDLE_RULE.test('da')).toBe(false);
    expect(HANDLE_RULE.test('Damla')).toBe(false);
    expect(HANDLE_RULE.test('damla-k')).toBe(false);
    expect(HANDLE_RULE.test('a'.repeat(31))).toBe(false);
    expect(normalizeHandle(' @Damla.K ')).toBe('damla.k');
  });

  it('suggests valid handles from the display name (Turkish letters folded)', () => {
    expect(handleSuggestions('Damla Kaya')).toEqual(['damla.k', 'damlastil', 'damla_dolap']);
    expect(handleSuggestions('Işıl')).toEqual(['isil.style', 'isilstil', 'isil_dolap']);
  });
});
