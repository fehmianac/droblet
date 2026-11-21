/**
 * UX turu 1 · F: 05 Üyelik opens by itself once, right after the first revealed try-on result, for a non-member only.
 * No AI and no network: the entitlement, the session and the router are mocked.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';

import { FIRST_TRY_ON_PAYWALL_DELAY_MS, firstTryOnPaywallKey, useFirstTryOnPaywall } from './firstTryOnPaywall';

const mockFocus = { focused: true };
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocus.focused }));

jest.mock('@/auth/session', () => ({ useSession: () => ({ status: 'signedIn', user: { id: 'u-first' } }) }));

const mockCredits = { isLoading: false, isMember: false };
jest.mock('@/features/credits/useAiCredits', () => ({ useAiCredits: () => mockCredits }));

const mockTeen = { hide: { paywall: false } };
jest.mock('@/features/teen/store', () => ({ currentTeenRules: () => mockTeen }));

const mockOpenPaywall = jest.fn();
jest.mock('@/features/teen/TeenLocks', () => ({ openPaywall: (...args: unknown[]) => mockOpenPaywall(...args) }));

/** Past the beat, then lets the storage read / write promises settle. */
async function passBeat() {
  await act(async () => {
    jest.advanceTimersByTime(FIRST_TRY_ON_PAYWALL_DELAY_MS + 10);
  });
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

async function run(revealed: boolean) {
  const hook = await renderHook((props: { revealed: boolean }) => useFirstTryOnPaywall(props.revealed), { initialProps: { revealed } });
  await passBeat();
  return hook;
}

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  mockOpenPaywall.mockClear();
  mockFocus.focused = true;
  mockCredits.isLoading = false;
  mockCredits.isMember = false;
  mockTeen.hide.paywall = false;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the first try-on paywall', () => {
  it('opens 05 once after the first revealed result of a non-member, and remembers it on this phone', async () => {
    const first = await run(true);
    expect(mockOpenPaywall).toHaveBeenCalledWith({ from: 'firstTryOn' });
    expect(await AsyncStorage.getItem(firstTryOnPaywallKey('u-first'))).not.toBeNull();
    await first.unmount();

    await run(true);
    expect(mockOpenPaywall).toHaveBeenCalledTimes(1);
  });

  it('waits for the reveal (nothing while the curtain is closed)', async () => {
    const hook = await run(false);
    expect(mockOpenPaywall).not.toHaveBeenCalled();
    await hook.rerender({ revealed: true });
    await passBeat();
    expect(mockOpenPaywall).toHaveBeenCalledTimes(1);
  });

  it('never opens for a member, a teen, an unknown entitlement or a screen left before the beat', async () => {
    mockCredits.isMember = true;
    await (await run(true)).unmount();
    mockCredits.isMember = false;
    mockCredits.isLoading = true;
    await (await run(true)).unmount();
    mockCredits.isLoading = false;
    mockTeen.hide.paywall = true;
    await (await run(true)).unmount();
    mockTeen.hide.paywall = false;
    mockFocus.focused = false;
    await (await run(true)).unmount();
    expect(mockOpenPaywall).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(firstTryOnPaywallKey('u-first'))).toBeNull();

    // Leaving within the beat cancels it; the flag stays unset, so the next first result still gets it.
    mockFocus.focused = true;
    const left = await renderHook(() => useFirstTryOnPaywall(true));
    await left.unmount();
    await passBeat();
    expect(mockOpenPaywall).not.toHaveBeenCalled();
  });
});
