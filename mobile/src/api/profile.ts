import { useMutation, useQuery } from '@tanstack/react-query';

import { mutationKeys, queryKeys } from '@/sync/queryKeys';
import { newClientMutation } from '@/sync/clientMutation';

import { apiRequest } from './client';
import type { BodyProfile, PutBodyProfileRequest, PutStyleProfileRequest, StyleProfile } from './contracts';
import { isGone } from './errors';

async function getOrNull<T>(path: string): Promise<T | null> {
  try {
    return await apiRequest<T>(path);
  } catch (e) {
    if (isGone(e)) return null;
    throw e;
  }
}

export function useStyleProfile() {
  return useQuery({
    queryKey: queryKeys.styleProfile,
    queryFn: () => getOrNull<StyleProfile>('v1/tenant/style-profile'),
  });
}

export function useBodyProfile() {
  return useQuery({
    queryKey: queryKeys.bodyProfile,
    queryFn: () => getOrNull<BodyProfile>('v1/tenant/body-profile'),
  });
}

/** Queued PUT. Function, optimistic update and 409/404 handling are registered in `sync/mutationFns`. */
export function useSaveStyleProfile() {
  const m = useMutation<StyleProfile, unknown, PutStyleProfileRequest>({ mutationKey: mutationKeys.putStyleProfile });
  return {
    ...m,
    save: (profile: StyleProfile) => m.mutate({ ...profile, clientMutationId: newClientMutation().clientMutationId }),
  };
}

export function useSaveBodyProfile() {
  const m = useMutation<BodyProfile, unknown, PutBodyProfileRequest>({ mutationKey: mutationKeys.putBodyProfile });
  return {
    ...m,
    save: (profile: BodyProfile) => m.mutate({ ...profile, clientMutationId: newClientMutation().clientMutationId }),
  };
}
