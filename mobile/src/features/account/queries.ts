import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type {
  MyPhotos,
  MyProfile,
  NotificationSettings,
  Palette,
  PaletteMismatch,
  ProfileStats,
} from '@/api/contracts/account';
import { fromSource } from '@/api/dataSource';
import { isGone } from '@/api/errors';
import { accountFixtures } from '@/fixtures/account';

export const accountKeys = {
  profile: ['tenant', 'profile', 'me'] as const,
  stats: ['tenant', 'profile', 'stats'] as const,
  photos: ['tenant', 'photo', 'list'] as const,
  notifications: ['tenant', 'user', 'notifications'] as const,
  palette: ['tenant', 'palette', 'current'] as const,
  paletteMismatch: ['tenant', 'palette', 'mismatch'] as const,
};

/** 28 / 29 — the user's own profile card and closet visibility. */
export function useMyProfile() {
  return useQuery({
    queryKey: accountKeys.profile,
    queryFn: () => fromSource('account', accountFixtures.profile, () => apiRequest<MyProfile>('v1/tenant/profile')),
  });
}

/** 28 / 29c — piece, look, follower and trip counts. */
export function useProfileStats() {
  return useQuery({
    queryKey: accountKeys.stats,
    queryFn: () => fromSource('account', accountFixtures.stats, () => apiRequest<ProfileStats>('v1/tenant/profile/stats')),
  });
}

/** 29 — active photos. Signed URLs are short-lived, so the result is never persisted. */
export function useMyPhotos() {
  return useQuery({
    queryKey: accountKeys.photos,
    meta: { persist: false },
    queryFn: () => fromSource('account', accountFixtures.photos, () => apiRequest<MyPhotos>('v1/tenant/photo')),
  });
}

export function useNotificationSettings() {
  return useQuery({
    queryKey: accountKeys.notifications,
    queryFn: () =>
      fromSource('account', accountFixtures.notifications, () => apiRequest<NotificationSettings>('v1/tenant/user/me/notifications')),
  });
}

/** 30 — `null` when no analysis exists yet. Polls while the Palette worker runs. */
export function usePalette() {
  return useQuery({
    queryKey: accountKeys.palette,
    queryFn: async (): Promise<Palette | null> => {
      try {
        return await fromSource('palette', accountFixtures.palette, () => apiRequest<Palette>('v1/tenant/palette'));
      } catch (e) {
        if (isGone(e)) return null;
        throw e;
      }
    },
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 1500 : false),
  });
}

/** 30 — "Uyumsuz parçaları gör". */
export function usePaletteMismatch(enabled: boolean) {
  return useQuery({
    queryKey: accountKeys.paletteMismatch,
    enabled,
    queryFn: () => fromSource('palette', accountFixtures.mismatch, () => apiRequest<PaletteMismatch>('v1/tenant/palette/mismatch')),
  });
}
