import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';

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
  PutProfileLanguageRequest,
  PutVisibilityRequest,
  RemovePhotoRequest,
} from '@/api/contracts/account';
import { fromSource } from '@/api/dataSource';
import { sessionStore } from '@/auth/session';
import type { AppLanguage } from '@/i18n';
import { openCreditSheetIfExhausted } from '@/features/credits/creditSheetStore';
import { accountFixtures } from '@/fixtures/account';
import { ulid } from '@/lib/ids';
import { newClientMutation } from '@/sync/clientMutation';
import { TENANT_WRITE_SCOPE } from '@/sync/queryKeys';
import { registerVersionedWrite } from '@/sync/versionedWrite';

import { accountKeys } from './queries';

export const accountMutationKeys = {
  putVisibility: ['tenant', 'profile', 'visibility', 'put'] as const,
  putLanguage: ['tenant', 'profile', 'language', 'put'] as const,
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
        () => apiRequest<MyProfile>('v1/tenant/profile/visibility', { method: 'PUT', body: vars }),
      ),
    optimistic: (prev, vars) => (prev ? { ...prev, closetVisibility: vars.closetVisibility } : prev),
  });

  registerVersionedWrite<PutProfileLanguageRequest, MyProfile>(client, {
    mutationKey: accountMutationKeys.putLanguage,
    queryKey: accountKeys.profile,
    send: (vars) =>
      fromSource(
        'account',
        () => accountFixtures.setLanguage(vars.language),
        () => apiRequest<MyProfile>('v1/tenant/profile', { method: 'PUT', body: vars }),
      ),
    optimistic: (prev, vars) => (prev ? { ...prev, language: vars.language } : prev),
  });

  registerVersionedWrite<PutNotificationSettingsRequest, NotificationSettings>(client, {
    mutationKey: accountMutationKeys.putNotifications,
    queryKey: accountKeys.notifications,
    send: (vars) =>
      fromSource(
        'account',
        () => accountFixtures.setNotifications(vars),
        () => apiRequest<NotificationSettings>('v1/tenant/user/me/notifications', { method: 'PUT', body: vars }),
      ),
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
        () => apiRequest<void>(`v1/tenant/photo/${vars.kind}/${vars.photoId}`, { method: 'DELETE' }),
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
      fromSource('palette', accountFixtures.analyzePalette, () => apiRequest<void>('v1/tenant/palette/analyze', { method: 'POST', body: vars })),
    onMutate: async () => {
      await client.cancelQueries({ queryKey: accountKeys.palette });
      client.setQueryData<Palette | null>(accountKeys.palette, (): Palette => ({ status: 'pending' }));
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: accountKeys.palette }),
    onError: (error: unknown) => {
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
          `droblet.query.${userId}`,
          `droblet.onboarding.${userId}`,
          `droblet.firstItems.${userId}`,
        ]).catch(() => undefined);
      }
      await sessionStore.clear();
    },
  });
}
