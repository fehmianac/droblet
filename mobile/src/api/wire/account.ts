/**
 * Wire shapes of Profil (28) and Gizlilik ve ayarlar (29) — `GET/PUT v1/tenant/profile` (+ `/visibility`,
 * `/handle`, `/stats`), `GET v1/tenant/settings`, `v1/tenant/user/me/{notifications,device}`,
 * `GET v1/tenant/photo` — and the mappers to the app types in `../contracts/account`.
 * Source: docs/api/store-social-settings.md §7 and `src/Api/Endpoints/V1/Tenant/{Profile,Photo,Settings,User}`.
 */
import type { AppLanguage } from '@/i18n';

import type { StyleTag } from '../contracts';
import type { ClosetVisibility, MyPhotos, MyProfile, NotificationSettings, ProfileStats } from '../contracts/account';
import type { PhotosWire, ProfileWire } from './core';

// ---------- profile ----------

export type ClosetVisibilityWire = ProfileWire['closetVisibility'];

export function toVisibility(wire: ClosetVisibilityWire): ClosetVisibility {
  return wire === 'followersOnly' ? 'followers' : wire;
}

export function fromVisibility(visibility: ClosetVisibility): ClosetVisibilityWire {
  return visibility === 'followers' ? 'followersOnly' : visibility;
}

const APP_LANGUAGES: readonly string[] = ['tr', 'en'];

/**
 * `ProfileDto` → the app's profile card. Style tags are not part of the profile on the wire (they
 * come from `GET v1/tenant/style-profile`). `avatarUrl` is a short-lived presigned GET.
 */
export function toMyProfile(wire: ProfileWire, styleTags: StyleTag[]): MyProfile {
  return {
    handle: wire.handle,
    displayName: wire.displayName ?? '',
    avatarUrl: wire.avatarUrl ?? null,
    ageConfirmedAt: wire.ageConfirmedAt ?? null,
    styleTags,
    closetVisibility: toVisibility(wire.closetVisibility),
    language: APP_LANGUAGES.includes(wire.language) ? (wire.language as AppLanguage) : null,
    cityId: wire.cityId,
    email: wire.email,
    emailVerified: wire.emailVerified ?? true,
    baseVersion: wire.version,
  };
}

/** PUT v1/tenant/profile/visibility → `ProfileWire`; 409 + current `ProfileWire`. */
export type PutVisibilityWire = { closetVisibility: ClosetVisibilityWire; baseVersion: number };

/**
 * PUT v1/tenant/profile — partial: an omitted / null field keeps its value. `cityId: ""` clears the
 * city. 400 `language_unsupported`, `name_required`; 409 + current `ProfileWire`.
 */
export type PutProfileWire = { displayName?: string; language?: string; cityId?: string; baseVersion: number };

/** GET v1/tenant/profile/handle/availability?handle= */
export type HandleAvailabilityWire = { handle: string; available: boolean; code: string | null };

/** PUT v1/tenant/profile/handle → `ProfileWire`. 400 `handle_invalid`, 409 `handle_taken`, 422 `handle_reserved`. */
export type PutHandleWire = { handle: string };

/** GET v1/tenant/profile/stats */
export type ProfileStatsWire = {
  itemCount: number;
  lookCount: number;
  tripCount: number;
  followerCount: number;
  followingCount: number;
};

export function toProfileStats(wire: ProfileStatsWire): ProfileStats {
  return {
    itemCount: wire.itemCount,
    lookCount: wire.lookCount,
    followerCount: wire.followerCount,
    followingCount: wire.followingCount,
    tripCount: wire.tripCount,
  };
}

// ---------- photos ----------

/** One active photo per kind on the server; the app's list of body photos has 0 or 1 entry. */
export function toMyPhotos(wire: PhotosWire): MyPhotos {
  return {
    body: wire.body ? [{ photoId: wire.body.id, url: wire.body.url }] : [],
    face: wire.face ? { photoId: wire.face.id, url: wire.face.url } : null,
    // The API does not count generated images; 29b then says "every generated image".
    generatedImageCount: null,
  };
}

// ---------- notifications, devices, settings ----------

/**
 * GET / PUT v1/tenant/user/me/notifications. `morningOutfitLocalTime` is the user's LOCAL wall-clock
 * time (`HH:mm`, quarter hours only) and stays correct across DST together with `timeZone` (IANA).
 * `version: 0` = never saved (all off). PUT: 409 + current, 400 `local_time_invalid`, `time_zone_invalid`.
 */
export type NotificationPrefsWire = {
  morningOutfit: boolean;
  morningOutfitLocalTime: string;
  weeklyEdit: boolean;
  friendRatings: boolean;
  /** Off by default; older servers omit it. */
  priceDrop?: boolean;
  /** Off by default; older servers omit it. */
  followRequests?: boolean;
  timeZone: string;
  version: number;
  updatedAt: string | null;
};

/** `priceDrop` / `followRequests` omitted or null keep the stored value. */
export type PutNotificationPrefsWire = Omit<NotificationPrefsWire, 'version' | 'updatedAt'> & { baseVersion: number };

export function toNotificationSettings(wire: NotificationPrefsWire): NotificationSettings {
  return {
    morningReminder: wire.morningOutfit,
    morningTimeLocal: wire.morningOutfitLocalTime,
    weeklyEdit: wire.weeklyEdit,
    friendRatings: wire.friendRatings,
    priceDrop: wire.priceDrop ?? false,
    followRequests: wire.followRequests ?? false,
    baseVersion: wire.version,
  };
}

export function fromNotificationSettings(settings: NotificationSettings, timeZone: string): PutNotificationPrefsWire {
  return {
    morningOutfit: settings.morningReminder,
    morningOutfitLocalTime: settings.morningTimeLocal,
    weeklyEdit: settings.weeklyEdit,
    friendRatings: settings.friendRatings,
    priceDrop: settings.priceDrop,
    followRequests: settings.followRequests,
    timeZone,
    baseVersion: settings.baseVersion,
  };
}

/** PUT v1/tenant/user/me/device (`deviceId` 8–100 chars). 422 `device_limit_reached` (10). Push tokens are never returned. */
export type PutDeviceWire = {
  deviceId: string;
  platform: 'ios' | 'android';
  pushToken?: string;
  /** apns = iOS APNs device token, fcm = Android FCM registration token (the server picks the channel by it). */
  pushTokenType?: 'apns' | 'fcm';
  timeZone?: string;
};
export type DeviceWire = { deviceId: string; platform: 'ios' | 'android'; pushEnabled: boolean; updatedAt: string };

/** GET v1/weather/city?q= rows, and `SettingsWire.city`. */
export type CityWire = {
  id: string;
  name: string;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  latitude: number;
  longitude: number;
  timeZone: string | null;
};

/** GET v1/tenant/settings — everything screen 29 needs in one call. */
export type SettingsWire = {
  closetVisibility: ClosetVisibilityWire;
  language: string;
  cityId: string | null;
  /** Null until the city was searched once. */
  city: CityWire | null;
  notifications: NotificationPrefsWire;
  devices: DeviceWire[];
  /** `baseVersion` for the profile and visibility PUTs. */
  profileVersion: number;
};
