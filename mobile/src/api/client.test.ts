import i18n from '@/i18n';

import { sessionStore } from '@/auth/session';

import { apiRequest, refreshTokens } from './client';

jest.mock('./config', () => ({ apiBaseUrl: () => 'https://api.example.test' }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  AFTER_FIRST_UNLOCK: 0,
}));

describe('apiRequest', () => {
  const fetchMock = jest.fn(async () => new Response('{}', { status: 200 }));

  beforeEach(() => {
    fetchMock.mockClear();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(async () => {
    await i18n.changeLanguage('tr');
  });

  it.each([
    ['tr', 'tr-TR'],
    ['en', 'en-GB'],
  ])('sends Accept-Language for the active app language (%s)', async (language, tag) => {
    await i18n.changeLanguage(language);
    await apiRequest('v1/catalog/library', { auth: false });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['Accept-Language']).toBe(tag);
  });

  it('registration sends the phone language, so the server stores it at sign-up', async () => {
    await i18n.changeLanguage('en');
    await apiRequest('v1/auth/register', { method: 'POST', body: { email: 'a@example.com' }, auth: false });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.test/v1/auth/register');
    expect((init.headers as Record<string, string>)['Accept-Language']).toBe('en-GB');
  });

  it('the token refresh carries Accept-Language too', async () => {
    await i18n.changeLanguage('tr');
    jest.spyOn(sessionStore, 'getTokens').mockReturnValue({ accessToken: 'a', refreshToken: 'r', expiresAt: 0, user: { id: 'u1', name: 'Damla', email: 'damla@example.com' } });
    jest.spyOn(sessionStore, 'setFromAuthResponse').mockResolvedValue(undefined);
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ accessToken: 'b' }), { status: 200 }));
    await refreshTokens();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.test/v1/auth/refresh');
    expect((init.headers as Record<string, string>)['Accept-Language']).toBe('tr-TR');
    jest.restoreAllMocks();
  });

  it('a suspended account (403 account_suspended on refresh) is signed out with the reason the auth screen shows', async () => {
    jest.spyOn(sessionStore, 'getTokens').mockReturnValue({ accessToken: 'a', refreshToken: 'r', expiresAt: 0, user: { id: 'u1', name: 'Damla', email: 'damla@example.com' } });
    const clear = jest.spyOn(sessionStore, 'clear').mockResolvedValue(undefined);
    fetchMock.mockImplementationOnce(
      async () => new Response(JSON.stringify({ status: 403, code: 'account_suspended' }), { status: 403, headers: { 'Content-Type': 'application/problem+json' } }),
    );
    await expect(refreshTokens()).rejects.toMatchObject({ kind: 'session_expired', code: 'account_suspended' });
    expect(clear).toHaveBeenCalledWith('suspended');
    jest.restoreAllMocks();
  });
});
