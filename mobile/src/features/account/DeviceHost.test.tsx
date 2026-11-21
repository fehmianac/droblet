import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';

import { PUSH_ASKED_KEY } from '@/notify/push';

const mockRegister = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('./device', () => ({ registerDevice: (...args: unknown[]) => mockRegister(...args) }));
const mockTrack = jest.fn();
jest.mock('@/analytics/track', () => ({ track: (...args: unknown[]) => mockTrack(...args) }));

// eslint-disable-next-line import/first
import { DeviceHost } from './DeviceHost';

const getPermissions = Notifications.getPermissionsAsync as jest.Mock;
const requestPermissions = Notifications.requestPermissionsAsync as jest.Mock;
const getToken = Notifications.getDevicePushTokenAsync as jest.Mock;

/** The onboarding store caches per user id: every test uses its own user. */
let n = 0;
async function startApp({ onboarded }: { onboarded: boolean }) {
  n += 1;
  const userId = `u-device-${n}`;
  await AsyncStorage.setItem(`droblet.onboarding.${userId}`, onboarded ? 'done' : 'pending');
  await render(<DeviceHost userId={userId} />);
  // Registration always ends with the device write.
  await waitFor(() => expect(mockRegister).toHaveBeenCalled());
  return userId;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  getPermissions.mockResolvedValue({ granted: false, canAskAgain: true, status: 'undetermined' });
  requestPermissions.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
  getToken.mockResolvedValue({ type: 'ios', data: 'apns-token' });
});

describe('DeviceHost (app start)', () => {
  it('does not prompt an onboarded user who was already asked; registers silently', async () => {
    await AsyncStorage.setItem(PUSH_ASKED_KEY, '2026-11-20T08:00:00Z');
    await startApp({ onboarded: true });
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(mockRegister).toHaveBeenCalledWith(undefined, undefined);
  });

  it('never prompts during onboarding (04d asks there)', async () => {
    await startApp({ onboarded: false });
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it('registers an already granted permission without a prompt', async () => {
    getPermissions.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
    await startApp({ onboarded: true });
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(mockRegister).toHaveBeenCalledWith('apns-token', 'apns');
  });

  it('legacy user (onboarded before 04d, never asked): the system prompt once, then never again', async () => {
    await startApp({ onboarded: true });
    expect(requestPermissions).toHaveBeenCalledTimes(1);
    expect(mockRegister).toHaveBeenCalledWith('apns-token', 'apns');
    expect(await AsyncStorage.getItem(PUSH_ASKED_KEY)).not.toBeNull();
    expect(mockTrack).toHaveBeenCalledWith('push_permission', { action: 'result', granted: true, source: 'app_start' });

    // Next app start: answered "no" in the meantime, the OS could still ask (Android) — the app does not.
    getPermissions.mockResolvedValue({ granted: false, canAskAgain: true, status: 'denied' });
    mockRegister.mockClear();
    await startApp({ onboarded: true });
    expect(requestPermissions).toHaveBeenCalledTimes(1);
  });

  it('legacy user whose answer is final (canAskAgain false): no prompt', async () => {
    getPermissions.mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied' });
    await startApp({ onboarded: true });
    expect(requestPermissions).not.toHaveBeenCalled();
  });
});
