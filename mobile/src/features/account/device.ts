import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { apiRequest } from '@/api/client';
import { DATA_SOURCE } from '@/api/dataSource';
import type { DeviceWire, PutDeviceWire } from '@/api/wire/account';
import { ulid } from '@/lib/ids';
import { deviceTimeZone } from '@/notify/time';

/**
 * This installation's id for `v1/tenant/user/me/device` (8–100 chars): a ULID created once and kept
 * in AsyncStorage. It is not a hardware identifier and is forgotten with the app's data.
 */
export const DEVICE_ID_KEY = 'droblet.deviceId';

let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (stored && stored.length >= 8) {
    cached = stored;
    return stored;
  }
  const created = ulid();
  await AsyncStorage.setItem(DEVICE_ID_KEY, created);
  cached = created;
  return created;
}

/** The id when this installation already has one — never creates it (used at sign-out). */
export async function peekDeviceId(): Promise<string | null> {
  if (cached) return cached;
  try {
    return await AsyncStorage.getItem(DEVICE_ID_KEY);
  } catch {
    return null;
  }
}

/**
 * `PUT v1/tenant/user/me/device` — registers / refreshes this installation with its platform and
 * time zone. `pushToken` is sent when the app has one (no push SDK is installed yet, so today the
 * device is registered without a token and `pushEnabled` stays false). 422 `device_limit_reached` (10).
 */
export async function registerDevice(pushToken?: string): Promise<DeviceWire | null> {
  if (DATA_SOURCE.account !== 'api') return null;
  const body: PutDeviceWire = {
    deviceId: await getDeviceId(),
    platform: Platform.OS === 'android' ? 'android' : 'ios',
    timeZone: deviceTimeZone(),
  };
  if (pushToken) body.pushToken = pushToken;
  return apiRequest<DeviceWire>('v1/tenant/user/me/device', { method: 'PUT', body });
}

/** `DELETE v1/tenant/user/me/device/{deviceId}` → 204 (idempotent). Sign-out removes the device by itself. */
export async function unregisterDevice(): Promise<void> {
  const deviceId = await peekDeviceId();
  if (!deviceId || DATA_SOURCE.account !== 'api') return;
  await apiRequest<void>(`v1/tenant/user/me/device/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
}
