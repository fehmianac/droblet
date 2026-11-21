/**
 * Canvas 19 · 04d Bildirim izni: when the step is offered after 04b, what each answer does, and the teen rows.
 * No AI and no network: expo-notifications is the Jest mock from `jest/setup.js`, the device write is mocked.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { onboardingStore } from '@/auth/onboarding';
import i18n from '@/i18n';
import { PUSH_ASKED_KEY } from '@/notify/push';

import PushPermissionScreen from '@/app/(onboarding)/push-permission';

import { continueAfterFirstItems } from './finish';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useRouter: () => ({ back: jest.fn() }),
  useCanGoBack: () => true,
}));

const mockRegister = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('@/features/account/device', () => ({ registerDevice: (...args: unknown[]) => mockRegister(...args) }));

const mockTrack = jest.fn();
jest.mock('@/analytics/track', () => ({ track: (...args: unknown[]) => mockTrack(...args) }));

const mockTeen = { teen: false };
jest.mock('@/features/teen/store', () => ({
  useTeenRules: () => ({ isTeen: mockTeen.teen, hide: { paywall: mockTeen.teen } }),
  currentTeenRules: () => ({ isTeen: mockTeen.teen, hide: { paywall: mockTeen.teen } }),
}));

jest.mock('@/auth/session', () => ({ useSession: () => ({ status: 'signedIn', user: { id: 'u-push' } }) }));

const getPermissions = Notifications.getPermissionsAsync as jest.Mock;
const requestPermissions = Notifications.requestPermissionsAsync as jest.Mock;
const getToken = Notifications.getDevicePushTokenAsync as jest.Mock;

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 54, left: 0, right: 0, bottom: 34 } };

function permission(granted: boolean, canAskAgain: boolean, status = granted ? 'granted' : canAskAgain ? 'undetermined' : 'denied') {
  getPermissions.mockResolvedValue({ granted, canAskAgain, status });
}

async function renderStep() {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <PushPermissionScreen />
    </SafeAreaProvider>,
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockTeen.teen = false;
  permission(false, true);
  requestPermissions.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
  getToken.mockResolvedValue({ type: 'ios', data: 'apns-token' });
});

describe('after 04b İlk 5 parça', () => {
  it('offers 04d while the permission is undetermined', async () => {
    await continueAfterFirstItems('u-push');
    expect(router.push).toHaveBeenCalledWith('/push-permission');
  });

  it('skips it when the permission is granted, refused for good, or this install was asked', async () => {
    const markDone = jest.spyOn(onboardingStore, 'markDone');
    permission(true, true);
    await continueAfterFirstItems('u-push');
    permission(false, false);
    await continueAfterFirstItems('u-push');
    permission(false, true);
    await AsyncStorage.setItem(PUSH_ASKED_KEY, '2026-11-01T08:00:00Z');
    await continueAfterFirstItems('u-push');
    expect(router.push).not.toHaveBeenCalled();
    // UX turu 1 · F: onboarding ends on Bugün (marked done; the guards open it), never on the paywall.
    expect(markDone).toHaveBeenCalledTimes(3);
    expect(markDone).toHaveBeenCalledWith('u-push');
  });

  it('skips it off native (web)', async () => {
    const markDone = jest.spyOn(onboardingStore, 'markDone');
    const restore = jest.replaceProperty(Platform, 'OS', 'web');
    await continueAfterFirstItems('u-push');
    restore.restore();
    expect(markDone).toHaveBeenCalledWith('u-push');
    expect(router.push).not.toHaveBeenCalled();
    expect(getPermissions).not.toHaveBeenCalled();
  });

  it('a teen skipping it goes to Bugün (no paywall): onboarding is marked done', async () => {
    mockTeen.teen = true;
    permission(true, true);
    const markDone = jest.spyOn(onboardingStore, 'markDone');
    await continueAfterFirstItems('u-push');
    expect(markDone).toHaveBeenCalledWith('u-push');
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('04d Bildirim izni', () => {
  it('lists the three benefits and tracks that it was shown', async () => {
    await renderStep();
    expect(screen.getByText(i18n.t('pushAsk.title'))).toBeTruthy();
    expect(screen.getByTestId('pushAsk.row.morning')).toBeTruthy();
    expect(screen.getByTestId('pushAsk.row.weekly')).toBeTruthy();
    expect(screen.getByTestId('pushAsk.row.result')).toBeTruthy();
    expect(mockTrack).toHaveBeenCalledWith('push_permission', { action: 'shown', source: 'onboarding', variant: 'adult' });
  });

  it('"Bildirimlere izin ver" shows the system prompt, registers the device and ends onboarding on Bugün', async () => {
    const markDone = jest.spyOn(onboardingStore, 'markDone');
    await renderStep();
    await act(async () => {
      fireEvent.press(screen.getByTestId('pushAsk.allow'));
    });
    await waitFor(() => expect(markDone).toHaveBeenCalledWith('u-push'));
    expect(router.push).not.toHaveBeenCalled();
    expect(mockTrack).toHaveBeenCalledWith('signup_step', { step: 'done' });
    expect(requestPermissions).toHaveBeenCalledTimes(1);
    expect(mockRegister).toHaveBeenCalledWith('apns-token', 'apns');
    expect(await AsyncStorage.getItem(PUSH_ASKED_KEY)).not.toBeNull();
    expect(mockTrack).toHaveBeenCalledWith('push_permission', { action: 'allow', source: 'onboarding', variant: 'adult' });
    expect(mockTrack).toHaveBeenCalledWith('push_permission', { action: 'result', granted: true, source: 'onboarding' });
  });

  it('a "no" in the system prompt still moves on and registers without a token', async () => {
    requestPermissions.mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied' });
    const markDone = jest.spyOn(onboardingStore, 'markDone');
    await renderStep();
    await act(async () => {
      fireEvent.press(screen.getByTestId('pushAsk.allow'));
    });
    await waitFor(() => expect(markDone).toHaveBeenCalledWith('u-push'));
    expect(mockRegister).toHaveBeenCalledWith(undefined, undefined);
    expect(mockTrack).toHaveBeenCalledWith('push_permission', { action: 'result', granted: false, source: 'onboarding' });
  });

  it('"Şimdi değil" shows no system prompt, remembers the answer and moves on', async () => {
    const markDone = jest.spyOn(onboardingStore, 'markDone');
    await renderStep();
    await act(async () => {
      fireEvent.press(screen.getByTestId('pushAsk.notNow'));
    });
    expect(markDone).toHaveBeenCalledWith('u-push');
    expect(router.push).not.toHaveBeenCalled();
    expect(requestPermissions).not.toHaveBeenCalled();
    await waitFor(async () => expect(await AsyncStorage.getItem(PUSH_ASKED_KEY)).not.toBeNull());
    expect(mockTrack).toHaveBeenCalledWith('push_permission', { action: 'decline', source: 'onboarding', variant: 'adult' });
  });

  it('teen: only the morning outfit and "result ready" rows; either answer ends onboarding (no paywall)', async () => {
    mockTeen.teen = true;
    const markDone = jest.spyOn(onboardingStore, 'markDone');
    await renderStep();
    expect(screen.getByTestId('pushAsk.row.morning')).toBeTruthy();
    expect(screen.getByTestId('pushAsk.row.result')).toBeTruthy();
    expect(screen.queryByTestId('pushAsk.row.weekly')).toBeNull();
    expect(mockTrack).toHaveBeenCalledWith('push_permission', { action: 'shown', source: 'onboarding', variant: 'teen' });
    await act(async () => {
      fireEvent.press(screen.getByTestId('pushAsk.notNow'));
    });
    expect(markDone).toHaveBeenCalledWith('u-push');
    expect(router.push).not.toHaveBeenCalled();
  });
});
