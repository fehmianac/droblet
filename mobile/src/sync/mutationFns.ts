import type { QueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type {
  BodyProfile,
  PutBodyProfileRequest,
  PutStyleProfileRequest,
  StyleProfile,
  WearLogRequest,
} from '@/api/contracts';
import { isConflict, isGone } from '@/api/errors';
import {
  fromBodyProfile,
  fromStyleProfile,
  toBodyProfile,
  toStyleProfile,
  type BodyProfileWire,
  type StyleProfileWire,
} from '@/api/wire/core';
import { registerLooksMutations } from '@/features/looks/mutations';
import { registerStylistMutations } from '@/features/stylist/mutations';
import { registerTodayMutations } from '@/features/today/mutations';
import { registerWardrobeMutations } from '@/features/wardrobe/mutations';
import { withLatency } from '@/fixtures/today';
import { ulid } from '@/lib/ids';

import { conflictStore } from './conflicts';
import { registerFeatureMutations } from './featureMutations';
import { mutationKeys, queryKeys, TENANT_WRITE_SCOPE } from './queryKeys';
import { uploadPhoto } from './photoUpload';

type Versioned = { baseVersion: number; clientMutationId: string };

/**
 * Registers the function for every queued write. Paused mutations are persisted without their
 * function, so a write queued offline can only resume after a restart if its key is registered here.
 */
export function registerMutationDefaults(client: QueryClient): void {
  /** `toWire` drops the client-only fields and renames to the wire spelling; `fromWire` maps 200 and 409 bodies back. */
  const versionedPut = <TBody extends Versioned, TRecord extends { baseVersion: number }, TWire>(
    key: readonly string[],
    path: string,
    queryKey: readonly string[],
    toWire: (vars: TBody) => unknown,
    fromWire: (wire: TWire) => TRecord,
  ) => {
    const execute = (vars: TBody) =>
      client
        .getMutationCache()
        .build(client, { mutationKey: key, scope: TENANT_WRITE_SCOPE })
        .execute(vars);

    client.setMutationDefaults(key, {
      scope: TENANT_WRITE_SCOPE,
      mutationFn: async (vars: TBody) => fromWire(await apiRequest<TWire>(path, { method: 'PUT', body: toWire(vars) })),
      onMutate: async (vars: TBody) => {
        await client.cancelQueries({ queryKey });
        const { clientMutationId: _omit, ...record } = vars;
        void _omit;
        client.setQueryData(queryKey, record);
      },
      onSuccess: (saved: TRecord | undefined) => {
        if (saved) client.setQueryData(queryKey, saved);
      },
      onError: (error: unknown, vars: TBody) => {
        if (isConflict(error)) {
          const current = error.current ? fromWire(error.current as TWire) : undefined;
          conflictStore.push({
            id: vars.clientMutationId,
            kind: 'changed',
            keepTheirs: () => {
              if (current) client.setQueryData(queryKey, current);
              else void client.invalidateQueries({ queryKey });
            },
            keepMine: current
              ? () => void execute({ ...vars, baseVersion: current.baseVersion, clientMutationId: ulid() })
              : undefined,
          });
          return;
        }
        if (isGone(error)) {
          conflictStore.push({
            id: vars.clientMutationId,
            kind: 'deleted',
            keepTheirs: () => void client.invalidateQueries({ queryKey }),
            keepMine: () => void execute({ ...vars, baseVersion: 0, clientMutationId: ulid() }),
          });
          return;
        }
        void client.invalidateQueries({ queryKey });
      },
    });
  };

  versionedPut<PutStyleProfileRequest, StyleProfile, StyleProfileWire>(
    mutationKeys.putStyleProfile,
    'v1/tenant/style-profile',
    queryKeys.styleProfile,
    fromStyleProfile,
    toStyleProfile,
  );
  versionedPut<PutBodyProfileRequest, BodyProfile, BodyProfileWire>(
    mutationKeys.putBodyProfile,
    'v1/tenant/body-profile',
    queryKeys.bodyProfile,
    fromBodyProfile,
    toBodyProfile,
  );

  client.setMutationDefaults(mutationKeys.uploadPhoto, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: uploadPhoto,
    retry: 3,
  });

  // Per-feature queued writes (Bugün E4, Gardırop E2/E3/E5, Stilist E5) register themselves.
  registerTodayMutations(client);
  registerWardrobeMutations(client);
  registerLooksMutations(client);
  registerStylistMutations(client);

  // Fixture-backed until the E4 wear-log contract exists (candidate: POST v1/tenant/wear-logs).
  client.setMutationDefaults(mutationKeys.createWearLog, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: WearLogRequest) => withLatency(vars, 200),
  });

  // Keşfet/mağaza/sepet, sosyal, profil/ayarlar/palet and analytics register their own writes.
  registerFeatureMutations(client);
}
