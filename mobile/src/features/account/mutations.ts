import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';

import { apiRequest } from '@/api/client';
import type {
  AnalyzePaletteRequest,
  ClosetVisibility,
  DeleteAllPhotosRequest,
  MyPhotos,
  MyProfile,
  NotificationSettings,
  Palette,
  PutNotificationSettingsRequest,
  PutProfileCityRequest,
  PutProfileLanguageRequest,
  PutProfileNameRequest,
  PutVisibilityRequest,
  RemovePhotoRequest,
} from '@/api/contracts/account';
import { DATA_SOURCE, fromSource } from '@/api/dataSource';
import { apiErrorCode, isPaywallError } from '@/api/errors';
import {
  fromNotificationSettings,
  fromVisibility,
  toNotificationSettings,
  type NotificationPrefsWire,
  type PutHandleWire,
  type PutProfileWire,
  type PutVisibilityWire,
} from '@/api/wire/account';
import type { ProfileWire } from '@/api/wire/core';
import { toPalette, type AnalyzePaletteResponseWire, type AnalyzePaletteWire } from '@/api/wire/palette';
import { deviceTimeZone, toQuarterHour } from '@/notify/time';
import { sessionStore } from '@/auth/session';
import type { AppLanguage } from '@/i18n';
import { openCreditSheetIfExhausted } from '@/features/credits/creditSheetStore';
import { accountFixtures } from '@/fixtures/account';
import { ulid } from '@/lib/ids';
import { newClientMutation } from '@/sync/clientMutation';
import { TENANT_WRITE_SCOPE } from '@/sync/queryKeys';
import { registerVersionedWrite } from '@/sync/versionedWrite';

import { DEVICE_ID_KEY } from './device';
import { accountKeys, profileFromWire } from './queries';

export const accountMutationKeys = {
  putVisibility: ['tenant', 'profile', 'visibility', 'put'] as const,
  putLanguage: ['tenant', 'profile', 'language', 'put'] as const,
  putCity: ['tenant', 'profile', 'city', 'put'] as const,
  putName: ['tenant', 'profile', 'name', 'put'] as const,
  removePhoto: ['tenant', 'photo', 'remove-one'] as const,
  deleteAllPhotos: ['tenant', 'photo', 'delete-all'] as const,
  putNotifications: ['tenant', 'user', 'notifications', 'put'] as const,
  analyzePalette: ['tenant', 'palette', 'analyze'] as const,
};

/** Private images must not outlive their deletion on this device either. */
function clearImageCaches() {
  void Image.clearDiskCache().catch(() => undefined);
  void Image.clearMemoryCache().catch(() => undefined);
}

/** Registers the function + optimistic update of every queued account write (see `sync/mutationFns`). */
export function registerAccountMutations(client: QueryClient): void {
  registerVersionedWrite<PutVisibilityRequest, MyProfile>(client, {
    mutationKey: accountMutationKeys.putVisibility,
    queryKey: accountKeys.profile,
    send: (vars) =>
      fromSource(
        'account',
        () => accountFixtures.setVisibility(vars.closetVisibility),
        async () => {
          const body: PutVisibilityWire = { closetVisibility: fromVisibility(vars.closetVisibility), baseVersion: vars.baseVersion };
          return profileFromWire(client, await apiRequest<ProfileWire>('v1/tenant/profile/visibility', { method: 'PUT', body }));
        },
      ),
    optimistic: (prev, vars) => (prev ? { ...prev, closetVisibility: vars.closetVisibility } : prev),
    mapCurrent: (wire) => profileFromWire(client, wire as ProfileWire),
  });

  registerVersionedWrite<PutProfileLanguageRequest, MyProfile>(client, {
    mutationKey: accountMutationKeys.putLanguage,
    queryKey: accountKeys.profile,
    send: (vars) =>
      fromSource(
        'account',
        () => accountFixtures.setLanguage(vars.language),
        async () => {
          // Partial update: only `language` travels, every other profile field keeps its value.
          const body: PutProfileWire = { language: vars.language, baseVersion: vars.baseVersion };
          return profileFromWire(client, await apiRequest<ProfileWire>('v1/tenant/profile', { method: 'PUT', body }));
        },
      ),
    optimistic: (prev, vars) => (prev ? { ...prev, language: vars.language } : prev),
    mapCurrent: (wire) => profileFromWire(client, wire as ProfileWire),
  });

  // Profile city (weather on Bugün, stylist): partial PUT with `cityId` only; `""` clears it.
  registerVersionedWrite<PutProfileCityRequest, MyProfile>(client, {
    mutationKey: accountMutationKeys.putCity,
    queryKey: accountKeys.profile,
    send: (vars) =>
      fromSource(
        'account',
        () => ({ ...accountFixtures.profile(), cityId: vars.cityId || null }),
        async () => {
          const body: PutProfileWire = { cityId: vars.cityId, baseVersion: vars.baseVersion };
          const saved = profileFromWire(client, await apiRequest<ProfileWire>('v1/tenant/profile', { method: 'PUT', body }));
          void client.invalidateQueries({ queryKey: accountKeys.settings });
          void client.invalidateQueries({ queryKey: ['tenant', 'today'] });
          return saved;
        },
      ),
    optimistic: (prev, vars) => (prev ? { ...prev, cityId: vars.cityId || null } : prev),
    mapCurrent: (wire) => profileFromWire(client, wire as ProfileWire),
  });

  // Display name: partial PUT with `displayName` only. 400 `name_required` for a blank name.
  registerVersionedWrite<PutProfileNameRequest, MyProfile>(client, {
    mutationKey: accountMutationKeys.putName,
    queryKey: accountKeys.profile,
    send: (vars) =>
      fromSource(
        'account',
        () => accountFixtures.setDisplayName(vars.displayName),
        async () => {
          const body: PutProfileWire = { displayName: vars.displayName, baseVersion: vars.baseVersion };
          return profileFromWire(client, await apiRequest<ProfileWire>('v1/tenant/profile', { method: 'PUT', body }));
        },
      ),
    optimistic: (prev, vars) => (prev ? { ...prev, displayName: vars.displayName } : prev),
    mapCurrent: (wire) => profileFromWire(client, wire as ProfileWire),
  });

  registerVersionedWrite<PutNotificationSettingsRequest, NotificationSettings>(client, {
    mutationKey: accountMutationKeys.putNotifications,
    queryKey: accountKeys.notifications,
    send: (vars) =>
      fromSource(
        'account',
        () => accountFixtures.setNotifications(vars),
        async () => {
          // Local wall-clock time (quarter hours) + the device's IANA zone; the server handles DST.
          const body = fromNotificationSettings({ ...vars, morningTimeLocal: toQuarterHour(vars.morningTimeLocal) }, deviceTimeZone());
          return toNotificationSettings(await apiRequest<NotificationPrefsWire>('v1/tenant/user/me/notifications', { method: 'PUT', body }));
        },
      ),
    mapCurrent: (wire) => toNotificationSettings(wire as NotificationPrefsWire),
    optimistic: (_prev, { clientMutationId: _id, ...settings }) => {
      void _id;
      return settings;
    },
  });

  client.setMutationDefaults(accountMutationKeys.removePhoto, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: RemovePhotoRequest) =>
      fromSource(
        'account',
        () => accountFixtures.removePhoto(vars.kind, vars.photoId),
        // 404 = that photo is no longer the active one (already replaced / removed): the list is re-read below.
        () => apiRequest<void>(`v1/tenant/photo/${vars.kind}/${encodeURIComponent(vars.photoId)}`, { method: 'DELETE' }),
      ),
    onMutate: async (vars: RemovePhotoRequest) => {
      await client.cancelQueries({ queryKey: accountKeys.photos });
      client.setQueryData<MyPhotos>(accountKeys.photos, (prev) => {
        if (!prev) return prev;
        return vars.kind === 'face'
          ? { ...prev, face: null }
          : { ...prev, body: prev.body.filter((p) => p.photoId !== vars.photoId) };
      });
    },
    onSettled: () => void client.invalidateQueries({ queryKey: accountKeys.photos }),
  });

  client.setMutationDefaults(accountMutationKeys.deleteAllPhotos, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (_vars: DeleteAllPhotosRequest) =>
      fromSource('account', accountFixtures.deleteAllPhotos, () => apiRequest<void>('v1/tenant/photo', { method: 'DELETE' })),
    onMutate: async () => {
      // Photos, every image generated on the user and the palette disappear from this device at once.
      await client.cancelQueries({ queryKey: accountKeys.photos });
      client.setQueryData<MyPhotos>(accountKeys.photos, { body: [], face: null, generatedImageCount: 0 });
      client.setQueryData<Palette | null>(accountKeys.palette, null);
      client.setQueryData<string | null>(accountKeys.paletteJob, null);
      client.removeQueries({ queryKey: ['tenant', 'tryon'] });
      clearImageCaches();
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: accountKeys.photos });
      void client.invalidateQueries({ queryKey: accountKeys.palette });
    },
  });

  client.setMutationDefaults(accountMutationKeys.analyzePalette, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: AnalyzePaletteRequest) =>
      fromSource<void>('palette', accountFixtures.analyzePalette, async () => {
        const body: AnalyzePaletteWire = { requestId: vars.requestId };
        const res = await apiRequest<AnalyzePaletteResponseWire>('v1/tenant/palette/analyze', { method: 'POST', body });
        if (res.status === 'cached') {
          // 200: the current face photo was already analysed — no job.
          client.setQueryData<string | null>(accountKeys.paletteJob, null);
          client.setQueryData<Palette | null>(accountKeys.palette, toPalette(res.palette));
        } else {
          // 202: `usePalette` polls this job until it settles.
          client.setQueryData<string | null>(accountKeys.paletteJob, res.job.id);
        }
      }),
    onMutate: async () => {
      await client.cancelQueries({ queryKey: accountKeys.palette });
      client.setQueryData<Palette | null>(accountKeys.palette, (): Palette => ({ status: 'pending' }));
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: accountKeys.palette }),
    onError: (error: unknown) => {
      // 403 premium_required → paywall; 422 face_photo_required → back to "upload a face photo".
      if (isPaywallError(error)) {
        client.setQueryData<Palette | null>(accountKeys.palette, null);
        router.push({ pathname: '/paywall', params: { from: 'palette' } });
        return;
      }
      if (apiErrorCode(error) === 'face_photo_required') {
        client.setQueryData<Palette | null>(accountKeys.palette, null);
        void client.invalidateQueries({ queryKey: accountKeys.photos });
        return;
      }
      const exhausted = openCreditSheetIfExhausted(error, 'palette');
      client.setQueryData<Palette | null>(accountKeys.palette, (): Palette | null => (exhausted ? null : { status: 'failed' }));
    },
  });
}

// ---------- Hooks ----------

export function useSetVisibility() {
  const m = useMutation<MyProfile, unknown, PutVisibilityRequest>({ mutationKey: accountMutationKeys.putVisibility });
  return (closetVisibility: ClosetVisibility, baseVersion: number) =>
    m.mutate({ closetVisibility, baseVersion, clientMutationId: newClientMutation().clientMutationId });
}

/** Saves the app language to the profile so server content, e-mails and notifications follow it. */
export function useSaveProfileLanguage() {
  const m = useMutation<MyProfile, unknown, PutProfileLanguageRequest>({ mutationKey: accountMutationKeys.putLanguage });
  return (language: AppLanguage, baseVersion: number) =>
    m.mutate({ language, baseVersion, clientMutationId: newClientMutation().clientMutationId });
}

/** Sets (or, with `""`, clears) the profile city — an id from `useCitySearch`. */
export function useSaveProfileCity() {
  const m = useMutation<MyProfile, unknown, PutProfileCityRequest>({ mutationKey: accountMutationKeys.putCity });
  return (cityId: string, baseVersion: number) =>
    m.mutate({ cityId, baseVersion, clientMutationId: newClientMutation().clientMutationId });
}

/** Saves the display name (trimmed; the caller does not send a blank one). */
export function useSaveDisplayName() {
  const m = useMutation<MyProfile, unknown, PutProfileNameRequest>({ mutationKey: accountMutationKeys.putName });
  return (displayName: string, baseVersion: number) =>
    m.mutate({ displayName: displayName.trim(), baseVersion, clientMutationId: newClientMutation().clientMutationId });
}

/**
 * Claims or changes the @handle (`PUT v1/tenant/profile/handle`). Interactive and online: the caller
 * shows the outcome — 400 `validation_failed` (`handle_invalid`), 409 `handle_taken`, 422 `handle_reserved`.
 * A handle is what makes the account findable (people search, follow, share links).
 */
export function useClaimHandle() {
  const client = useQueryClient();
  return useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: (handle: string) =>
      fromSource<MyProfile>(
        'account',
        () => accountFixtures.setHandle(handle.trim().replace(/^@/, '').toLowerCase()),
        async () => {
          const body: PutHandleWire = { handle: handle.trim().replace(/^@/, '') };
          return profileFromWire(client, await apiRequest<ProfileWire>('v1/tenant/profile/handle', { method: 'PUT', body }));
        },
      ),
    onSuccess: (profile) => client.setQueryData<MyProfile>(accountKeys.profile, profile),
  });
}

/** Removes the palette result (`DELETE v1/tenant/palette` → 204); the face photo stays. */
export function useDeletePalette() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => fromSource<void>('palette', () => undefined, () => apiRequest<void>('v1/tenant/palette', { method: 'DELETE' })),
    onSuccess: () => {
      client.setQueryData<string | null>(accountKeys.paletteJob, null);
      client.setQueryData<Palette | null>(accountKeys.palette, null);
    },
  });
}

export function useSaveNotificationSettings() {
  const m = useMutation<NotificationSettings, unknown, PutNotificationSettingsRequest>({
    mutationKey: accountMutationKeys.putNotifications,
  });
  return (settings: NotificationSettings) =>
    m.mutate({ ...settings, clientMutationId: newClientMutation().clientMutationId });
}

export function useRemovePhoto() {
  const m = useMutation<void, unknown, RemovePhotoRequest>({ mutationKey: accountMutationKeys.removePhoto });
  return (kind: 'body' | 'face', photoId: string) =>
    m.mutate({ kind, photoId, clientMutationId: newClientMutation().clientMutationId });
}

export function useDeleteAllPhotos() {
  const m = useMutation<void, unknown, DeleteAllPhotosRequest>({ mutationKey: accountMutationKeys.deleteAllPhotos });
  return () => m.mutate({ clientMutationId: newClientMutation().clientMutationId });
}

export function useAnalyzePalette() {
  const m = useMutation<void, unknown, AnalyzePaletteRequest>({ mutationKey: accountMutationKeys.analyzePalette });
  return () => {
    const id = ulid();
    m.mutate({ requestId: id, clientMutationId: id });
  };
}

/**
 * What "Profili düzenle" saves. `avatar`: a newly picked local file, `null` to remove the photo, absent
 * to keep it — the API has no avatar upload yet, so it is applied in fixture mode only (see
 * `AVATAR_EDIT_SUPPORTED`).
 */
export type ProfileEdit = { displayName: string; handle: string; avatar?: { localUri: string } | null; baseVersion: number };

/** The backend has no avatar endpoint yet: the edit form hides "change photo" against the real API. */
export const AVATAR_EDIT_SUPPORTED = DATA_SOURCE.account === 'fixtures';

/**
 * 28 "Profili düzenle" — name and handle. Interactive and online-only (never queued): whether the handle
 * is free is the server's answer, and the user must see it at once. Real API: the name is a partial
 * `PUT v1/tenant/profile { displayName, baseVersion }` (409 + the current profile on a version race);
 * a changed handle goes to `PUT v1/tenant/profile/handle` (409 `handle_taken`, 422 `handle_reserved`,
 * 400 `handle_invalid`).
 */
export function useUpdateProfile() {
  const client = useQueryClient();
  return useMutation<MyProfile, unknown, ProfileEdit>({
    networkMode: 'always',
    retry: false,
    mutationFn: (edit) =>
      fromSource(
        'account',
        () =>
          accountFixtures.updateProfile(
            {
              displayName: edit.displayName,
              handle: edit.handle,
              baseVersion: edit.baseVersion,
              clientMutationId: newClientMutation().clientMutationId,
            },
            edit.avatar === undefined ? undefined : (edit.avatar?.localUri ?? null),
          ),
        async () => {
          const before = client.getQueryData<MyProfile>(accountKeys.profile);
          let saved = before;
          if (!before || edit.displayName !== before.displayName) {
            const body: PutProfileWire = { displayName: edit.displayName, baseVersion: edit.baseVersion };
            saved = profileFromWire(client, await apiRequest<ProfileWire>('v1/tenant/profile', { method: 'PUT', body }));
            client.setQueryData(accountKeys.profile, saved);
          }
          if (!saved || edit.handle !== (saved.handle ?? '')) {
            const body: PutHandleWire = { handle: edit.handle };
            saved = profileFromWire(client, await apiRequest<ProfileWire>('v1/tenant/profile/handle', { method: 'PUT', body }));
          }
          return saved;
        },
      ),
    onSuccess: (saved) => {
      // Every screen reads the name from the profile query; the session copy follows for the rest.
      client.setQueryData(accountKeys.profile, saved);
      void sessionStore.updateUser({ name: saved.displayName });
    },
  });
}

/**
 * 29c — `DELETE v1/auth/me`. Interactive and online-only (never queued: the user must see it
 * happen). On success everything this account left on the device is removed, then the session ends.
 */
export function useDeleteAccount() {
  const client = useQueryClient();
  return useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async () => {
      const state = sessionStore.getState();
      const userId = state.status === 'signedIn' ? state.user.id : null;
      await apiRequest<void>('v1/auth/me', { method: 'DELETE' });
      client.getMutationCache().clear();
      client.clear();
      clearImageCaches();
      if (userId) {
        await AsyncStorage.multiRemove([
          DEVICE_ID_KEY,
          `droblet.query.${userId}`,
          `droblet.onboarding.${userId}`,
          `droblet.firstItems.${userId}`,
        ]).catch(() => undefined);
      }
      await sessionStore.clear();
    },
  });
}
