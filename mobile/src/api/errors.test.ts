import { ApiError, extractApiError, fieldErrors, isConflict } from './errors';

describe('extractApiError', () => {
  it('maps business codes to their translation key', () => {
    expect(extractApiError(new ApiError('http', 409, { code: 'email_taken' }))).toBe('email_taken');
    expect(extractApiError(new ApiError('http', 401, { code: 'invalid_credentials' }))).toBe('invalid_credentials');
  });

  it('maps transport problems', () => {
    expect(extractApiError(new ApiError('network', null, null))).toBe('network');
    expect(extractApiError(new ApiError('config', null, null))).toBe('config_missing');
    expect(extractApiError(new ApiError('http', 429, null))).toBe('rate_limited');
  });

  it('falls back to unknown', () => {
    expect(extractApiError(new Error('x'))).toBe('unknown');
    expect(extractApiError(new ApiError('http', 500, { code: 'something_new' }))).toBe('unknown');
  });

  it('reads ProblemDetails field errors with camel-cased keys', () => {
    const e = new ApiError('http', 400, { errors: { Email: ['bad'], Password: ['short'] } });
    expect(fieldErrors(e)).toEqual({ email: 'bad', password: 'short' });
  });

  it('detects conflicts', () => {
    expect(isConflict(new ApiError('http', 409, null))).toBe(true);
    expect(isConflict(new ApiError('http', 400, null))).toBe(false);
  });
});
