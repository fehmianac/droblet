import { useMutation, useQuery } from '@tanstack/react-query';

import { mutationKeys, queryKeys } from '@/sync/queryKeys';
import { newClientMutation } from '@/sync/clientMutation';

import { apiRequest } from './client';
import type { BodyProfile, PutBodyProfileRequest, PutStyleProfileRequest, StyleProfile } from './contracts';
import { fromSource } from './dataSource';
import { isGone } from './errors';
import { toBodyProfile, toStyleProfile, type BodyProfileWire, type StyleProfileWire } from './wire/core';

async function getOrNull<TWire, T>(path: string, map: (wire: TWire) => T): Promise<T | null> {
  try {
    return map(await apiRequest<TWire>(path));
  } catch (e) {
    if (isGone(e)) return null;
    throw e;
  }
}

/** GET v1/tenant/style-profile → null when not set yet (404). */
export function useStyleProfile() {
  return useQuery({
    queryKey: queryKeys.styleProfile,
    queryFn: () => getOrNull<StyleProfileWire, StyleProfile>('v1/tenant/style-profile', toStyleProfile),
  });
}

/** Fixture builds / tests: the stored body profile (null = none yet, like a 404). */
let bodyProfileFixture: BodyProfile | null = null;
export function setBodyProfileFixture(profile: BodyProfile | null): void {
  bodyProfileFixture = profile;
}

/** GET v1/tenant/body-profile → null when not set yet (404). */
export function useBodyProfile() {
  return useQuery({
    queryKey: queryKeys.bodyProfile,
    queryFn: () =>
      fromSource<BodyProfile | null>(
        'account',
        () => (bodyProfileFixture ? { ...bodyProfileFixture } : null),
        () => getOrNull<BodyProfileWire, BodyProfile>('v1/tenant/body-profile', toBodyProfile),
      ),
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
