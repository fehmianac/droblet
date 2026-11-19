/**
 * Temporary self-serve premium (owner decision 2026-11-19): the Ayarlar section and the paywall link, against
 * a fake `v1/tenant/entitlement` + `…/self-premium` server (real hooks, real query client).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { fireEvent as routerFireEvent, renderRouter, screen as routerScreen, waitFor as routerWaitFor } from 'expo-router/testing-library';

import { ApiError } from '@/api/errors';
import type { EntitlementWire } from '@/api/wire/core';
import { useAiCredits } from '@/features/credits/useAiCredits';
import { SelfPremiumCard } from '@/features/account/SelfPremiumCard';
import i18n from '@/i18n';
import { getActiveQueryClient } from '@/sync/activeClient';

const mockSession = {
  accessToken: 'a',
  refreshToken: 'r',
  expiresAt: Date.now() + 3_600_000,
  user: { id: 'u1', name: 'Damla', email: 'damla@example.com' },
};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => JSON.stringify(mockSession)),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  AFTER_FIRST_UNLOCK: 0,
}));
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));

/** The AI credit query reads the API too (not the fixtures), so the refresh after the switch is visible. */
jest.mock('@/api/dataSource', () => {
  const actual = jest.requireActual('@/api/dataSource');
  return {
    ...actual,
    fromSource: (feature: string, fixture: () => unknown, api: () => Promise<unknown>) => (feature === 'jobs' ? api() : actual.fromSource(feature, fixture, api)),
  };
});

const mockApiRequest = jest.fn();
jest.mock('@/api/client', () => ({ apiRequest: (...args: unknown[]) => mockApiRequest(...args) }));

const server = { enabled: true, active: false, calls: [] as string[] };

function entitlementWire(): EntitlementWire {
  const premium = server.active;
  return {
    tier: premium ? 'premium' : 'free',
    productId: premium ? 'self_test' : null,
    platform: null,
    expiresAt: null,
    credits: { monthlyAllowance: premium ? 30 : 0, allowanceRemaining: premium ? 30 : 0, packRemaining: 0, totalRemaining: premium ? 30 : 0, resetsAt: null },
    itemRecognition: premium ? { limit: null, used: 0, remaining: null } : { limit: 10, used: 0, remaining: 10 },
    selfServePremium: { enabled: server.enabled, active: server.active },
  };
}

async function fakeApi(path: string, options: { method?: string } = {}) {
  const method = options.method ?? 'GET';
  server.calls.push(`${method} ${path}`);
  if (path === 'v1/tenant/entitlement' && method === 'GET') return entitlementWire();
  if (path === 'v1/tenant/entitlement/self-premium') {
    if (!server.enabled) throw new ApiError('http', 403, { code: 'self_premium_disabled' } as never);
    server.active = method === 'POST';
    return entitlementWire();
  }
  throw new ApiError('http', 404, { code: 'not_found' } as never);
}

function Credits() {
  const credits = useAiCredits();
  return credits.remaining === null ? null : <Text>{`credits:${credits.remaining}:${credits.isMember ? 'member' : 'free'}`}</Text>;
}

const clients: QueryClient[] = [];
async function renderCard() {
  // gcTime Infinity: no gc timer is left behind when the test unmounts.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  clients.push(client);
  await render(
    <QueryClientProvider client={client}>
      <SelfPremiumCard />
      <Credits />
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(async () => {
  server.enabled = true;
  server.active = false;
  server.calls = [];
  mockApiRequest.mockImplementation(fakeApi);
  await AsyncStorage.clear();
  await i18n.changeLanguage('tr');
});
afterEach(() => {
  // No cache / gc timers outlive a test (also the router tests' own client).
  for (const client of clients.splice(0)) client.clear();
  getActiveQueryClient()?.clear();
});
afterAll(async () => {
  await i18n.changeLanguage('tr');
});

describe('29 · Geçici üyelik', () => {
  // Fake timers: the button's loader loop and the query cache's timers end with each test.
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('is not shown while the server switch is off', async () => {
    server.enabled = false;
    await renderCard();
    await waitFor(() => expect(screen.getByText('credits:0:free')).toBeTruthy());
    expect(screen.queryByTestId('settings.selfPremium')).toBeNull();
  });

  it('turns premium on: credits and member features update at once; then off again', async () => {
    await renderCard();
    await waitFor(() => expect(screen.getByText('Geçici üyelik — ödeme entegrasyonu açılana kadar')).toBeTruthy());
    expect(screen.getByText('GEÇİCİ ÜYELİK')).toBeTruthy();
    expect(screen.getByText('credits:0:free')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByText("Premium'u etkinleştir"));
    });
    await waitFor(() => expect(screen.getByText("Premium'u kapat")).toBeTruthy());
    expect(server.calls).toContain('POST v1/tenant/entitlement/self-premium');
    // The AI credit query was refetched: 30 credits, member.
    await waitFor(() => expect(screen.getByText('credits:30:member')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByText("Premium'u kapat"));
    });
    await waitFor(() => expect(screen.getByText("Premium'u etkinleştir")).toBeTruthy());
    expect(server.calls).toContain('DELETE v1/tenant/entitlement/self-premium');
    await waitFor(() => expect(screen.getByText('credits:0:free')).toBeTruthy());
  });

  it('switched off meanwhile: says so, and the section disappears after the refresh', async () => {
    await renderCard();
    await waitFor(() => expect(screen.getByText("Premium'u etkinleştir")).toBeTruthy());
    server.enabled = false;
    await act(async () => {
      fireEvent.press(screen.getByText("Premium'u etkinleştir"));
    });
    await waitFor(() => expect(screen.queryByTestId('settings.selfPremium')).toBeNull());
  });

  it('English strings', async () => {
    await i18n.changeLanguage('en');
    await renderCard();
    await waitFor(() => expect(screen.getByText('Temporary membership — until payments are live')).toBeTruthy());
    expect(screen.getByText('Turn on Premium')).toBeTruthy();
  });
});

describe('05 paywall · "Şimdilik ücretsiz etkinleştir"', () => {
  const WAIT = { timeout: 5000 };

  it('is offered while self premium is enabled and turns premium on', async () => {
    await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
    await renderRouter('./src/app', { initialUrl: '/paywall' });
    await routerWaitFor(() => expect(routerScreen.getByTestId('paywall.selfPremium')).toBeTruthy(), WAIT);
    expect(routerScreen.getByText('Şimdilik ücretsiz etkinleştir')).toBeTruthy();

    await routerFireEvent.press(routerScreen.getByTestId('paywall.selfPremium'));
    await routerWaitFor(() => expect(server.calls).toContain('POST v1/tenant/entitlement/self-premium'), WAIT);
    // Member now: the offer and the link are gone.
    await routerWaitFor(() => expect(routerScreen.queryByTestId('paywall.selfPremium')).toBeNull(), WAIT);
  });

  it('is not offered when the switch is off', async () => {
    server.enabled = false;
    await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
    await renderRouter('./src/app', { initialUrl: '/paywall' });
    await routerWaitFor(() => expect(routerScreen.getByTestId('paywall.buy')).toBeTruthy(), WAIT);
    await routerWaitFor(() => expect(server.calls).toContain('GET v1/tenant/entitlement'), WAIT);
    expect(routerScreen.queryByTestId('paywall.selfPremium')).toBeNull();
  });
});
