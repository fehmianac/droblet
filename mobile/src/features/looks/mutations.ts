import type { QueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type { CreateLookRequest, Look, PutLookRequest } from '@/api/contracts/looks';
import { isConflict, isGone } from '@/api/errors';
import { fromSource } from '@/api/source';
import { registerTripMutations } from '@/features/trips/mutations';
import { fixtureCreateLook, fixtureDeleteLook, fixturePutLook } from '@/fixtures/looks';
import { ulid } from '@/lib/ids';
import { conflictStore } from '@/sync/conflicts';
import { TENANT_WRITE_SCOPE } from '@/sync/queryKeys';

import { lookKeys } from './queries';

/** Mutation keys — every queued write has one so it can resume after an app restart. */
export const lookMutationKeys = {
  create: ['tenant', 'look', 'create'] as const,
  put: ['tenant', 'look', 'put'] as const,
  remove: ['tenant', 'look', 'delete'] as const,
};

/** `optimistic` is what the cache shows until the server answers; only `request` goes over the wire. */
export type CreateLookVariables = { request: CreateLookRequest; optimistic: Look };
export type PutLookVariables = { id: string; request: PutLookRequest; optimistic: Look };
export type DeleteLookVariables = { id: string; clientMutationId: string };

function upsert(list: Look[] | undefined, look: Look): Look[] | undefined {
  if (!list) return list;
  return list.some((l) => l.id === look.id) ? list.map((l) => (l.id === look.id ? look : l)) : [look, ...list];
}

function writeLook(client: QueryClient, look: Look): void {
  client.setQueryData<Look[]>(lookKeys.looks, (prev) => upsert(prev, look));
  client.setQueryData<Look>(lookKeys.look(look.id), look);
}

/**
 * Queued writes of the looks + trips slice. Paused mutations are persisted without their function, so
 * every write must register its `mutationFn` here by key to resume after an app restart.
 */
export function registerLooksMutations(client: QueryClient): void {
  const invalidate = () => void client.invalidateQueries({ queryKey: lookKeys.looks });
  const rerun = <V>(key: readonly string[], vars: V) =>
    void client.getMutationCache().build(client, { mutationKey: key, scope: TENANT_WRITE_SCOPE }).execute(vars);

  client.setMutationDefaults(lookMutationKeys.create, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: CreateLookVariables) =>
      fromSource<Look>(
        'wardrobe',
        () => fixtureCreateLook(vars.request),
        () => apiRequest<Look>('v1/tenant/look', { method: 'POST', body: vars.request }),
      ),
    onMutate: async (vars: CreateLookVariables) => {
      await client.cancelQueries({ queryKey: lookKeys.looks });
      writeLook(client, vars.optimistic);
    },
    onSuccess: (saved: Look | undefined) => {
      if (saved) writeLook(client, saved);
    },
    onError: invalidate,
  });

  client.setMutationDefaults(lookMutationKeys.put, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: PutLookVariables) => {
      // Writes are sent in order: an earlier queued write of the same look may have moved the version on.
      const cached = client.getQueryData<Look>(lookKeys.look(vars.id))?.baseVersion ?? 0;
      const request: PutLookRequest = { ...vars.request, baseVersion: Math.max(vars.request.baseVersion, cached) };
      return fromSource<Look>(
        'wardrobe',
        () => fixturePutLook(vars.id, request),
        () => apiRequest<Look>(`v1/tenant/look/${vars.id}`, { method: 'PUT', body: request }),
      );
    },
    onMutate: async (vars: PutLookVariables) => {
      await client.cancelQueries({ queryKey: lookKeys.looks });
      // Keep the server's version number: the optimistic copy must not pretend to be saved.
      writeLook(client, vars.optimistic);
    },
    onSuccess: (saved: Look | undefined) => {
      if (saved) writeLook(client, saved);
    },
    onError: (error: unknown, vars: PutLookVariables) => {
      if (isConflict(error)) {
        const current = error.problem?.current as Look | undefined;
        conflictStore.push({
          id: vars.request.clientMutationId,
          kind: 'changed',
          keepTheirs: () => {
            if (current) writeLook(client, current);
            else invalidate();
          },
          keepMine: current
            ? () =>
                rerun<PutLookVariables>(lookMutationKeys.put, {
                  ...vars,
                  optimistic: { ...vars.optimistic, baseVersion: current.baseVersion },
                  request: { ...vars.request, baseVersion: current.baseVersion, clientMutationId: ulid() },
                })
            : undefined,
        });
        if (current) writeLook(client, current);
        return;
      }
      if (isGone(error)) {
        conflictStore.push({
          id: vars.request.clientMutationId,
          kind: 'deleted',
          keepTheirs: invalidate,
          keepMine: () =>
            rerun<CreateLookVariables>(lookMutationKeys.create, {
              optimistic: { ...vars.optimistic, baseVersion: 0 },
              request: {
                id: vars.id,
                name: vars.request.name,
                occasion: vars.request.occasion,
                slots: vars.request.slots,
                clientMutationId: ulid(),
              },
            }),
        });
        invalidate();
        return;
      }
      invalidate();
    },
  });

  client.setMutationDefaults(lookMutationKeys.remove, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: DeleteLookVariables) =>
      fromSource<void>(
        'wardrobe',
        () => fixtureDeleteLook(vars.id),
        () => apiRequest<void>(`v1/tenant/look/${vars.id}`, { method: 'DELETE' }),
      ),
    onMutate: async (vars: DeleteLookVariables) => {
      await client.cancelQueries({ queryKey: lookKeys.looks });
      client.setQueryData<Look[]>(lookKeys.looks, (prev) => prev?.filter((l) => l.id !== vars.id));
      client.removeQueries({ queryKey: lookKeys.look(vars.id), exact: true });
    },
    onError: (error: unknown) => {
      // Already deleted elsewhere = the outcome the user wanted.
      if (!isGone(error)) invalidate();
    },
  });

  registerTripMutations(client);
}
