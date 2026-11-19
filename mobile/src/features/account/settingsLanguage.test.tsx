/**
 * Regression (owner, 2026-11-19): the language switch in 29 worked once; a second switch did nothing.
 * Root cause: the screen read the language with a plain `currentLanguage()` call, which the React
 * Compiler (on in the app and, since then, in Jest) caches for the component's lifetime — the chip and
 * the "already selected" guard kept the first language. This renders the real screen, the real
 * `LanguageSyncHost` and the real queued profile write against a versioned fake server.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiError } from '@/api/errors';
import type { ProfileWire } from '@/api/wire/core';
import { LanguageSyncHost } from '@/features/account/LanguageSyncHost';
import { accountKeys } from '@/features/account/queries';
import i18n from '@/i18n';
import { resetLanguagePreferenceForTests } from '@/i18n/preference';
import { createQueryClient } from '@/sync/queryClient';

import SettingsScreen from '@/app/settings';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() }, useRouter: () => ({ back: jest.fn() }), useCanGoBack: () => true }));

/** The profile endpoints of the API go to the fake server; every other feature stays on fixtures. */
jest.mock('@/api/dataSource', () => {
  const actual = jest.requireActual('@/api/dataSource');
  return {
    ...actual,
    fromSource: (feature: string, fixture: () => unknown, api: () => Promise<unknown>) =>
      feature === 'account' && (globalThis as { __profileApi?: boolean }).__profileApi ? api() : actual.fromSource(feature, fixture, api),
  };
});

type Put = { language?: string; baseVersion: number };
const server: { profile: ProfileWire; puts: Put[]; conflicts: number } = {
  profile: {} as ProfileWire,
  puts: [],
  conflicts: 0,
};

const mockApiRequest = jest.fn();
jest.mock('@/api/client', () => ({ apiRequest: (...args: unknown[]) => mockApiRequest(...args) }));

/** A versioned profile endpoint: a PUT on an old version answers 409 with the current record. */
async function fakeApi(path: string, options: { method?: string; body?: unknown } = {}) {
  if (path === 'v1/tenant/profile' && (options.method ?? 'GET') === 'GET') return { ...server.profile };
  if (path === 'v1/tenant/profile' && options.method === 'PUT') {
    const body = options.body as Put;
    server.puts.push(body);
    if (body.baseVersion !== server.profile.version) {
      server.conflicts += 1;
      throw new ApiError('http', 409, { ...server.profile } as never);
    }
    server.profile = { ...server.profile, language: body.language ?? server.profile.language, version: server.profile.version + 1 };
    return { ...server.profile };
  }
  throw new ApiError('http', 404, { code: 'not_found' } as never);
}

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 54, left: 0, right: 0, bottom: 34 } };

beforeEach(async () => {
  // Fake timers: fixture latency, skeleton shimmer and the query cache's timers end with the test.
  jest.useFakeTimers();
  mockApiRequest.mockImplementation(fakeApi);
  (globalThis as { __profileApi?: boolean }).__profileApi = true;
  server.profile = {
    tenantId: 't1',
    displayName: 'Elif',
    handle: 'elif',
    email: 'elif@example.com',
    closetVisibility: 'private',
    language: 'tr',
    cityId: null,
    version: 1,
    updatedAt: '2026-11-19T08:00:00Z',
  };
  server.puts = [];
  server.conflicts = 0;
  resetLanguagePreferenceForTests();
  await AsyncStorage.clear();
  await i18n.changeLanguage('tr');
});

const clients: ReturnType<typeof createQueryClient>[] = [];
afterEach(() => {
  // No gc / retry timers outlive the test.
  for (const client of clients.splice(0)) client.clear();
  jest.clearAllTimers();
  jest.useRealTimers();
});

afterAll(async () => {
  delete (globalThis as { __profileApi?: boolean }).__profileApi;
  await i18n.changeLanguage('tr');
});

function chip(name: 'Türkçe' | 'English') {
  return screen.getByRole('radio', { name });
}

describe('29 language switch', () => {
  it('switches tr → en → tr → en: the UI follows every time and each profile write is on the latest version', async () => {
    const client = createQueryClient();
    clients.push(client);
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <QueryClientProvider client={client}>
          <SettingsScreen />
          <LanguageSyncHost />
        </QueryClientProvider>
      </SafeAreaProvider>,
    );
    await waitFor(() => expect(client.getQueryData(accountKeys.profile)).toBeTruthy());
    expect(screen.getByText('DİL')).toBeTruthy();
    expect(chip('Türkçe').props.accessibilityState).toMatchObject({ checked: true });

    const steps = [
      { tap: 'English', language: 'en', title: 'LANGUAGE' },
      { tap: 'Türkçe', language: 'tr', title: 'DİL' },
      { tap: 'English', language: 'en', title: 'LANGUAGE' },
    ] as const;

    for (const [index, step] of steps.entries()) {
      await act(async () => {
        fireEvent.press(chip(step.tap));
      });
      // The app language, the selected chip and the screen's own strings switch at once.
      await waitFor(() => expect(i18n.language).toBe(step.language));
      expect(screen.getByText(step.title)).toBeTruthy();
      expect(chip(step.tap).props.accessibilityState).toMatchObject({ checked: true });
      expect(await AsyncStorage.getItem('droblet.language')).toBe(step.language);
      // Exactly one queued write per switch, sent on the version the previous write produced.
      await waitFor(() => expect(server.puts).toHaveLength(index + 1));
      expect(server.puts[index]).toEqual({ language: step.language, baseVersion: index + 1 });
      await waitFor(() => expect(server.profile.language).toBe(step.language));
    }

    expect(server.conflicts).toBe(0);
    expect(server.puts.map((p) => p.language)).toEqual(['en', 'tr', 'en']);
    // Nothing reverted the choice afterwards.
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(i18n.language).toBe('en');
    expect(server.puts).toHaveLength(3);
  });

  it('a quick double switch queued behind the first write goes out on the newer version (no 409, no revert)', async () => {
    const client = createQueryClient();
    clients.push(client);
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <QueryClientProvider client={client}>
          <SettingsScreen />
          <LanguageSyncHost />
        </QueryClientProvider>
      </SafeAreaProvider>,
    );
    await waitFor(() => expect(client.getQueryData(accountKeys.profile)).toBeTruthy());
    await act(async () => {
      fireEvent.press(chip('English'));
    });
    await act(async () => {
      fireEvent.press(chip('Türkçe'));
    });
    await waitFor(() => expect(server.profile.language).toBe('tr'));
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(i18n.language).toBe('tr');
    expect(server.conflicts).toBe(0);
    expect(server.puts).toEqual([
      { language: 'en', baseVersion: 1 },
      { language: 'tr', baseVersion: 2 },
    ]);
  });
});
