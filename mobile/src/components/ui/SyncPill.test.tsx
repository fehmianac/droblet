import { onlineManager, QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { act, render, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '@/i18n';
import { ApiError } from '@/api/errors';
import { TENANT_WRITE_SCOPE } from '@/sync/queryKeys';

import { SYNC_PILL_HIDE_DELAY_MS, SYNC_PILL_SHOW_DELAY_MS, SyncPill, useSyncPillPhase } from './SyncPill';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 54, left: 0, right: 0, bottom: 34 } };

async function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </SafeAreaProvider>
  );
  const hook = await renderHook(
    () => ({ phase: useSyncPillPhase(), write: useMutation({ scope: TENANT_WRITE_SCOPE, mutationFn: (p: Promise<void>) => p }) }),
    { wrapper },
  );
  return { client, hook, wrapper };
}

/** Lets a settled mutation reach its observers (promise ticks + the batched notify). */
async function flush() {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
    jest.advanceTimersByTime(1);
  }
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  onlineManager.setOnline(true);
});

describe('sync pill', () => {
  it('stays hidden for a quick write; shows "syncing" only after 600 ms, then "synced" for 1.2 s', async () => {
    const { hook } = await setup();
    let finish = () => undefined as void;
    const slow = new Promise<void>((resolve) => (finish = resolve));
    await act(async () => hook.result.current.write.mutate(slow));
    expect(hook.result.current.phase).toBe('hidden');
    await act(async () => jest.advanceTimersByTime(SYNC_PILL_SHOW_DELAY_MS - 50));
    expect(hook.result.current.phase).toBe('hidden');
    await act(async () => jest.advanceTimersByTime(100));
    expect(hook.result.current.phase).toBe('syncing');
    await act(async () => {
      finish();
      await flush();
    });
    expect(hook.result.current.phase).toBe('synced');
    await act(async () => jest.advanceTimersByTime(SYNC_PILL_HIDE_DELAY_MS + 10));
    expect(hook.result.current.phase).toBe('hidden');

    // A write that settles within the delay never shows anything.
    await act(async () => hook.result.current.write.mutate(Promise.resolve()));
    await act(async () => jest.advanceTimersByTime(SYNC_PILL_SHOW_DELAY_MS * 2));
    expect(hook.result.current.phase).toBe('hidden');
  });

  it('is persistent while offline and reports a write that failed for lack of a connection', async () => {
    const { hook } = await setup();
    await act(async () => onlineManager.setOnline(false));
    expect(hook.result.current.phase).toBe('offline');
    await act(async () => onlineManager.setOnline(true));
    expect(hook.result.current.phase).toBe('hidden');
    await act(async () => {
      hook.result.current.write.mutate(Promise.reject(new ApiError('network', null, null)));
      await flush();
    });
    expect(hook.result.current.phase).toBe('error');
  });

  it('a refused write (4xx) is not a sync problem', async () => {
    const { hook } = await setup();
    await act(async () => {
      hook.result.current.write.mutate(Promise.reject(new ApiError('http', 422, { code: 'x' })));
      await flush();
    });
    expect(hook.result.current.phase).toBe('hidden');
  });

  it('floats over the content: absolutely positioned, so it never changes any height', async () => {
    const { wrapper } = await setup();
    await act(async () => onlineManager.setOnline(false));
    const screen = await render(<SyncPill />, { wrapper });
    expect(screen.getByText('Offline · changes saved on device')).toBeTruthy();
    expect(screen.getByTestId('sync-pill-layer').props.style).toMatchObject({ position: 'absolute', top: 54 + 54 });
  });
});
