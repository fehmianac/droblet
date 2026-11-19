import { FixtureNotFound } from '@/fixtures/db';

import { ApiError, extractApiError, fieldErrors, isConflict, isNotFound } from './errors';

describe('extractApiError', () => {
  it('maps business codes to their translation key', () => {
    expect(extractApiError(new ApiError('http', 409, { code: 'email_taken' }))).toBe('email_taken');
    expect(extractApiError(new ApiError('http', 401, { code: 'invalid_credentials' }))).toBe('invalid_credentials');
    expect(extractApiError(new ApiError('http', 403, { code: 'account_suspended' }))).toBe('account_suspended');
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

describe('isNotFound', () => {
  it('is true for a 404 / 410 answer and a fixture miss', () => {
    expect(isNotFound(new ApiError('http', 404, { code: 'not_found' }))).toBe(true);
    expect(isNotFound(new ApiError('http', 404, null))).toBe(true);
    expect(isNotFound(new ApiError('http', 410, null))).toBe(true);
    expect(isNotFound(new FixtureNotFound('look x'))).toBe(true);
  });

  it('is false for network, server, auth and other client errors (they keep "Try again")', () => {
    expect(isNotFound(new ApiError('network', null, null))).toBe(false);
    expect(isNotFound(new ApiError('http', 500, null))).toBe(false);
    expect(isNotFound(new ApiError('http', 503, null))).toBe(false);
    expect(isNotFound(new ApiError('http', 409, null))).toBe(false);
    expect(isNotFound(new ApiError('session_expired', 404, null))).toBe(false);
    expect(isNotFound(new Error('boom'))).toBe(false);
    expect(isNotFound(null)).toBe(false);
  });
});
