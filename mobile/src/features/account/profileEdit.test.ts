import { handleStatus, normaliseHandle } from './profileEdit';

const base = { current: 'damla', checking: false, failed: false, saveError: null };

describe('profile edit: @handle', () => {
  it('normalises what the user types', () => {
    expect(normaliseHandle('  @Ayse.K ')).toBe('ayse.k');
  });

  it('reports availability from the server and only allows saving a free handle', () => {
    expect(handleStatus({ ...base, value: '', checked: '', availability: undefined })).toEqual({ kind: 'idle', canSave: false });
    expect(handleStatus({ ...base, value: 'damla', checked: 'damla', availability: undefined })).toEqual({ kind: 'current', canSave: false });
    expect(handleStatus({ ...base, value: 'ayse', checked: 'ays', availability: undefined })).toEqual({ kind: 'checking', canSave: false });
    expect(
      handleStatus({ ...base, value: 'ayse', checked: 'ayse', availability: { handle: 'ayse', available: true, code: null } }),
    ).toEqual({ kind: 'available', canSave: true });
    expect(
      handleStatus({ ...base, value: 'selin', checked: 'selin', availability: { handle: 'selin', available: false, code: 'handle_taken' } }),
    ).toEqual({ kind: 'taken', canSave: false });
    expect(
      handleStatus({ ...base, value: 'admin', checked: 'admin', availability: { handle: 'admin', available: false, code: 'handle_reserved' } }),
    ).toEqual({ kind: 'reserved', canSave: false });
    expect(
      handleStatus({ ...base, value: 'a', checked: 'a', availability: { handle: 'a', available: false, code: 'handle_invalid' } }),
    ).toEqual({ kind: 'invalid', canSave: false });
  });

  it('a failed check does not block saving; a refused save wins over an older answer', () => {
    expect(handleStatus({ ...base, value: 'ayse', checked: 'ayse', availability: undefined, failed: true })).toEqual({ kind: 'unknown', canSave: true });
    expect(
      handleStatus({
        ...base,
        value: 'ayse',
        checked: 'ayse',
        availability: { handle: 'ayse', available: true, code: null },
        saveError: 'handle_taken',
      }),
    ).toEqual({ kind: 'taken', canSave: false });
    expect(handleStatus({ ...base, current: null, value: 'ayse', checked: 'ayse', availability: undefined, saveError: 'handle_reserved' }).kind).toBe(
      'reserved',
    );
  });
});
