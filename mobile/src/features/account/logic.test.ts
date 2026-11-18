import { HANDLE_MAX, isLightTone, NAME_MAX, normalizeHandle, photoDeleteLines, validateProfile } from './logic';

describe('edit profile validation', () => {
  it('normalizes a handle: no @, no spaces around, lower-case ASCII (Turkish İ / I / ı → i)', () => {
    expect(normalizeHandle('  @Damla ')).toBe('damla');
    expect(normalizeHandle('@@İREM_Ilık')).toBe('irem_ilik');
    expect(normalizeHandle('stil.editor')).toBe('stil.editor');
  });

  it('accepts a name and a handle of letters, digits, dots and underscores', () => {
    expect(validateProfile({ displayName: 'Damla', handle: '@damla_86' })).toEqual({});
    expect(validateProfile({ displayName: 'Damla', handle: 'd.a.m' })).toEqual({});
  });

  it('requires a name and caps its length', () => {
    expect(validateProfile({ displayName: '   ', handle: 'damla' }).displayName).toBe('nameRequired');
    expect(validateProfile({ displayName: 'a'.repeat(NAME_MAX + 1), handle: 'damla' }).displayName).toBe('nameTooLong');
    expect(validateProfile({ displayName: 'a'.repeat(NAME_MAX), handle: 'damla' }).displayName).toBeUndefined();
  });

  it('explains what is wrong with a handle', () => {
    const handleError = (handle: string) => validateProfile({ displayName: 'Damla', handle }).handle;
    expect(handleError('')).toBe('handleRequired');
    expect(handleError('@')).toBe('handleRequired');
    expect(handleError('da')).toBe('handleTooShort');
    expect(handleError('d'.repeat(HANDLE_MAX + 1))).toBe('handleTooLong');
    expect(handleError('damla çelik')).toBe('handleInvalid');
    expect(handleError('damla-86')).toBe('handleInvalid');
    expect(handleError('şık')).toBe('handleInvalid');
    // Same shape rule as the server: letter / digit at both ends, no "..".
    expect(handleError('.damla')).toBe('handleInvalid');
    expect(handleError('damla_')).toBe('handleInvalid');
    expect(handleError('dam..la')).toBe('handleInvalid');
    expect(handleError('damla.86')).toBeUndefined();
  });
});

describe('29b delete list', () => {
  it('puts the body and face photos on one line, as the board draws it', () => {
    expect(photoDeleteLines({ body: [1], face: {}, generatedImageCount: 48 }, true)).toEqual([
      { key: 'bodyAndFace', count: 1 },
      { key: 'generated', count: 48 },
      { key: 'palette' },
    ]);
  });

  it('lists only what the account has', () => {
    expect(photoDeleteLines({ body: [1, 2], face: null, generatedImageCount: 0 }, false)).toEqual([
      { key: 'bodyPhotos', count: 2 },
      { key: 'generatedAll' },
    ]);
    expect(photoDeleteLines({ body: [], face: {}, generatedImageCount: null }, false)).toEqual([{ key: 'facePhoto' }, { key: 'generatedAll' }]);
    expect(photoDeleteLines(undefined, false)).toEqual([{ key: 'generatedAll' }]);
  });
});

describe('30 swatch hairline', () => {
  it('is drawn only around tones close to the paper surface', () => {
    expect(isLightTone('#E8DCC6')).toBe(true);
    expect(isLightTone('#F2F2F2')).toBe(true);
    expect(isLightTone('#C9B79C')).toBe(false);
    expect(isLightTone('#7A4E3A')).toBe(false);
    expect(isLightTone('#9FD3E8')).toBe(false);
    expect(isLightTone('not a colour')).toBe(false);
  });
});
