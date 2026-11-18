import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import { registerDevice } from '@/features/account/device';

/**
 * Push (README §9.2: no Expo push service — the server sends through APNs on iOS and FCM on Android).
 * The device push token comes straight from the OS via expo-notifications: an APNs device token on
 * iOS, an FCM registration token on Android (needs google-services.json in the build). It is
 * registered with `PUT v1/tenant/user/me/device` together with its type; sign-out removes the device
 * server-side (`POST v1/auth/logout` carries the device id).
 */
export type PushTokenType = 'apns' | 'fcm';

const nativePush = () => Platform.OS === 'ios' || Platform.OS === 'android';

let channelReady: Promise<void> | null = null;

/** Android 8+: notifications need a channel before the permission prompt can appear. */
function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelReady ??= Notifications.setNotificationChannelAsync('default', {
    name: 'Droblet',
    importance: AndroidImportance.DEFAULT,
  })
    .then(() => undefined)
    .catch(() => undefined);
  return channelReady;
}

export async function pushPermissionGranted(): Promise<boolean> {
  if (!nativePush()) return false;
  try {
    const status = await Notifications.getPermissionsAsync();
    return status.granted;
  } catch {
    return false;
  }
}

/** Shows the system prompt (only when the OS still allows asking). True when push is allowed afterwards. */
export async function requestPushPermission(): Promise<boolean> {
  if (!nativePush()) return false;
  await ensureChannel();
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const next = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
    return next.granted;
  } catch {
    return false;
  }
}

/** The OS push token and its channel, or null (no permission, simulator, Android build without Firebase config). */
export async function devicePushToken(): Promise<{ token: string; type: PushTokenType } | null> {
  if (!nativePush()) return null;
  try {
    const token = await Notifications.getDevicePushTokenAsync();
    return typeof token.data === 'string' && token.data.length > 0
      ? { token: token.data, type: Platform.OS === 'ios' ? 'apns' : 'fcm' }
      : null;
  } catch {
    return null;
  }
}

/**
 * Registers this installation. `ask` = show the permission prompt when it has not been answered yet
 * (after onboarding, or when a notification toggle is switched on); otherwise only an already granted
 * permission yields a token. Best effort — never throws.
 */
export async function syncPushRegistration({ ask }: { ask: boolean }): Promise<boolean> {
  try {
    const granted = ask ? await requestPushPermission() : await pushPermissionGranted();
    const push = granted ? await devicePushToken() : null;
    await registerDevice(push?.token, push?.type);
    return push !== null;
  } catch {
    return false;
  }
}
