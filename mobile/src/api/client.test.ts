import i18n from '@/i18n';

import { apiRequest } from './client';

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
});
