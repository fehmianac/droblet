import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type { StyleTag } from '@/api/contracts';
import type { CityOption, MyPhotos, MyProfile, NotificationSettings, Palette, PaletteMismatch, ProfileStats } from '@/api/contracts/account';
import type { ProductPage } from '@/api/contracts/store';
import { fromSource, queryString } from '@/api/dataSource';
import { ApiError, isGone } from '@/api/errors';
import {
  toMyPhotos,
  toMyProfile,
  toNotificationSettings,
  toProfileStats,
  type CityWire,
  type NotificationPrefsWire,
  type ProfileStatsWire,
  type SettingsWire,
} from '@/api/wire/account';
import { toJob, toStyleProfile, type JobWire, type PhotosWire, type ProfileWire, type StyleProfileWire } from '@/api/wire/core';
import { toPalette, toPaletteMismatch, type PaletteMismatchWire, type PaletteWire } from '@/api/wire/palette';
import { toProductPage, type ProductPageWire } from '@/api/wire/store';
import { sessionStore } from '@/auth/session';
import { accountFixtures } from '@/fixtures/account';
import { queryKeys } from '@/sync/queryKeys';

export const accountKeys = {
  profile: ['tenant', 'profile', 'me'] as const,
  stats: ['tenant', 'profile', 'stats'] as const,
  photos: ['tenant', 'photo', 'list'] as const,
  settings: ['tenant', 'settings'] as const,
  notifications: ['tenant', 'user', 'notifications'] as const,
  palette: ['tenant', 'palette', 'current'] as const,
  /** Id of the palette job that is still running (persisted, so a restarted app resumes the wait). */
  paletteJob: ['tenant', 'palette', 'job'] as const,
  paletteMismatch: ['tenant', 'palette', 'mismatch'] as const,
  paletteProducts: (pageToken: string | null) => ['tenant', 'palette', 'products', pageToken ?? 'first'] as const,
  cities: (q: string) => ['weather', 'city', q] as const,
};

/** Style tags live in the style profile, not in `ProfileDto`; 404 (not set yet) reads as none. */
async function readStyleTags(client: QueryClient): Promise<StyleTag[]> {
  const cached = client.getQueryData<{ styleTags: StyleTag[] } | null>(queryKeys.styleProfile);
  if (cached) return cached.styleTags;
  try {
    return toStyleProfile(await apiRequest<StyleProfileWire>('v1/tenant/style-profile')).styleTags;
  } catch (e) {
    if (isGone(e)) return [];
    throw e;
  }
}

/** Maps a `ProfileDto` (200 or the 409 body of a profile PUT) keeping the style tags the cache already has. */
export function profileFromWire(client: QueryClient, wire: ProfileWire): MyProfile {
  const previous = client.getQueryData<MyProfile>(accountKeys.profile);
  const styleProfile = client.getQueryData<{ styleTags: StyleTag[] } | null>(queryKeys.styleProfile);
  return toMyProfile(wire, styleProfile?.styleTags ?? previous?.styleTags ?? []);
}

/** 28 / 29 — the user's own profile card and closet visibility (`GET v1/tenant/profile`). */
export function useMyProfile() {
  const client = useQueryClient();
  return useQuery({
    queryKey: accountKeys.profile,
    queryFn: () =>
      fromSource('account', accountFixtures.profile, async () => {
        const [wire, styleTags] = await Promise.all([apiRequest<ProfileWire>('v1/tenant/profile'), readStyleTags(client)]);
        // E-mail login and social sign-in learn the display name / e-mail here.
        void sessionStore.updateUser({
          ...(wire.displayName ? { name: wire.displayName } : {}),
          ...(wire.email ? { email: wire.email } : {}),
        });
        return toMyProfile(wire, styleTags);
      }),
  });
}

/** 28 / 29c — piece, look, follower, following and trip counts (`GET v1/tenant/profile/stats`). */
export function useProfileStats() {
  return useQuery({
    queryKey: accountKeys.stats,
    queryFn: () =>
      fromSource<ProfileStats>('account', accountFixtures.stats, async () =>
        toProfileStats(await apiRequest<ProfileStatsWire>('v1/tenant/profile/stats')),
      ),
  });
}

/** 29 — active photos (`GET v1/tenant/photo`). Signed URLs are short-lived, so the result is never persisted. */
export function useMyPhotos() {
  return useQuery({
    queryKey: accountKeys.photos,
    meta: { persist: false },
    queryFn: () =>
      fromSource<MyPhotos>('account', accountFixtures.photos, async () => toMyPhotos(await apiRequest<PhotosWire>('v1/tenant/photo'))),
  });
}

/** `GET v1/tenant/user/me/notifications` (`version: 0` = never saved, all off). */
export function useNotificationSettings() {
  return useQuery({
    queryKey: accountKeys.notifications,
    queryFn: () =>
      fromSource<NotificationSettings>('account', accountFixtures.notifications, async () =>
        toNotificationSettings(await apiRequest<NotificationPrefsWire>('v1/tenant/user/me/notifications')),
      ),
  });
}

/** What 29 needs besides the profile, as the API has it in one call: chosen city, registered devices. */
export type AccountSettings = {
  city: CityOption | null;
  devices: { deviceId: string; platform: 'ios' | 'android'; pushEnabled: boolean }[];
  profileVersion: number;
};

function toCityOption(wire: CityWire): CityOption {
  return { id: wire.id, name: wire.name, region: wire.region, country: wire.country };
}

/** `GET v1/tenant/settings` — city (weather on Bugün / stylist) and the devices registered for push. */
export function useAccountSettings() {
  return useQuery({
    queryKey: accountKeys.settings,
    queryFn: () =>
      fromSource<AccountSettings>(
        'account',
        () => ({ city: null, devices: [], profileVersion: accountFixtures.profile().baseVersion }),
        async () => {
          const wire = await apiRequest<SettingsWire>('v1/tenant/settings');
          return {
            city: wire.city ? toCityOption(wire.city) : null,
            devices: wire.devices.map((d) => ({ deviceId: d.deviceId, platform: d.platform, pushEnabled: d.pushEnabled })),
            profileVersion: wire.profileVersion,
          };
        },
      ),
  });
}

/** City autocomplete for the profile city (`GET v1/weather/city?q=`, 2–60 chars; 503 `weather_unavailable`). */
export function useCitySearch(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: accountKeys.cities(term),
    enabled: term.length >= 2,
    queryFn: () =>
      fromSource<CityOption[]>(
        'account',
        () => [],
        async () => (await apiRequest<CityWire[]>(`v1/weather/city${queryString({ q: term })}`)).map(toCityOption),
      ),
  });
}

/**
 * The palette as the API has it. While a palette job is running (its id is kept under
 * `accountKeys.paletteJob`) the job is polled: queued / processing → `pending`; failed → `failed`
 * with the failure code; completed → the palette itself. No job → `GET v1/tenant/palette`
 * (404 `palette_not_found` is thrown and read as "no analysis yet" by the hook).
 */
async function readPalette(client: QueryClient): Promise<Palette> {
  const jobId = client.getQueryData<string | null>(accountKeys.paletteJob);
  if (jobId) {
    let job;
    try {
      job = await toJob(await apiRequest<JobWire>(`v1/tenant/job/${jobId}`));
    } catch (e) {
      // An unknown (expired) job is over; anything else (offline) keeps waiting.
      if (!(e instanceof ApiError) || e.status !== 404) throw e;
      job = null;
    }
    if (job && (job.status === 'queued' || job.status === 'running')) return { status: 'pending' };
    client.setQueryData<string | null>(accountKeys.paletteJob, null);
    if (job?.status === 'failed') return { status: 'failed', reason: job.error?.code };
  }
  return toPalette(await apiRequest<PaletteWire>('v1/tenant/palette'));
}

/** 30 — `null` when no analysis exists yet. Polls while the Palette worker runs. */
export function usePalette() {
  const client = useQueryClient();
  return useQuery({
    queryKey: accountKeys.palette,
    queryFn: async (): Promise<Palette | null> => {
      try {
        return await fromSource('palette', accountFixtures.palette, () => readPalette(client));
      } catch (e) {
        if (isGone(e)) return null;
        throw e;
      }
    },
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 1500 : false),
  });
}

/** 30 — "Uyumsuz parçaları gör" (`GET v1/tenant/palette/mismatch`). */
export function usePaletteMismatch(enabled: boolean) {
  return useQuery({
    queryKey: accountKeys.paletteMismatch,
    enabled,
    meta: { persist: false },
    queryFn: () =>
      fromSource<PaletteMismatch>('palette', accountFixtures.mismatch, async () =>
        toPaletteMismatch(await apiRequest<PaletteMismatchWire>('v1/tenant/palette/mismatch')),
      ),
  });
}

/**
 * "Paletime uygun ürünler" as the server computes it (`GET v1/tenant/palette/products`: the catalogue
 * restricted to the palette's flattering colours, main colour not in `avoid`; same paging as the
 * catalogue). 404 `palette_not_found` without an analysis.
 */
export function usePaletteProducts(enabled: boolean, pageToken: string | null = null) {
  return useQuery({
    queryKey: accountKeys.paletteProducts(pageToken),
    enabled,
    queryFn: () =>
      fromSource<ProductPage>(
        'palette',
        () => ({ items: [], nextPageToken: null }),
        async () => toProductPage(await apiRequest<ProductPageWire>(`v1/tenant/palette/products${queryString({ pageToken })}`)),
      ),
  });
}
