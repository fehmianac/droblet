import type { QueryClient } from '@tanstack/react-query';

import { isConflict, isGone } from '@/api/errors';
import { ulid } from '@/lib/ids';

import { conflictStore } from './conflicts';
import { TENANT_WRITE_SCOPE } from './queryKeys';

type Versioned = { baseVersion: number; clientMutationId: string };

type Options<TVars extends Versioned, TRecord extends { baseVersion: number }> = {
  mutationKey: readonly string[];
  queryKey: readonly string[];
  send: (vars: TVars) => Promise<TRecord>;
  /** The record to show while the write is queued. */
  optimistic: (previous: TRecord | undefined, vars: TVars) => TRecord | undefined;
  /**
   * Converts the 409 body (the server's current record, wire shape) into the app record. May return a
   * promise when the mapping needs other data. Omit when wire and app shapes are the same.
   */
  mapCurrent?: (wire: unknown) => TRecord | Promise<TRecord>;
  /**
   * A partial write of one field whose value the device decides (the profile language — owner decision
   * 2026-11-18 —, the city): on 409 it is re-sent once on the server's current version instead of asking
   * "which one should we keep?". A version that moved on again after that still asks.
   */
  rebaseOnConflict?: boolean;
};

/** Writes already re-sent once on a newer version (by their new client mutation id). */
const rebased = new Set<string>();

/**
 * A queued, versioned write for the feature modules: optimistic cache update, and on 409 / 404 the
 * write is set aside and the user decides (ConflictHost) — nothing is overwritten silently.
 * Same behaviour as the profile PUTs registered in `mutationFns.ts`, for records whose optimistic
 * value is not simply the request body.
 */
export function registerVersionedWrite<TVars extends Versioned, TRecord extends { baseVersion: number }>(
  client: QueryClient,
  { mutationKey, queryKey, send, optimistic, mapCurrent, rebaseOnConflict = false }: Options<TVars, TRecord>,
): void {
  const execute = (vars: TVars) =>
    client.getMutationCache().build(client, { mutationKey, scope: TENANT_WRITE_SCOPE }).execute(vars);

  client.setMutationDefaults(mutationKey, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: send,
    onMutate: async (vars: TVars) => {
      await client.cancelQueries({ queryKey });
      client.setQueryData<TRecord>(queryKey, (prev) => optimistic(prev, vars));
    },
    onSuccess: (saved: TRecord | undefined) => {
      if (saved) client.setQueryData(queryKey, saved);
    },
    onError: async (error: unknown, vars: TVars) => {
      if (isConflict(error)) {
        let current: TRecord | undefined;
        try {
          current = error.current ? (mapCurrent ? await mapCurrent(error.current) : (error.current as TRecord)) : undefined;
        } catch {
          current = undefined;
        }
        if (rebaseOnConflict && current && !rebased.has(vars.clientMutationId)) {
          const clientMutationId = ulid();
          rebased.add(clientMutationId);
          client.setQueryData(queryKey, current);
          // Its own failure goes through this same onError (a second conflict asks the user).
          void execute({ ...vars, baseVersion: current.baseVersion, clientMutationId }).catch(() => undefined);
          return;
        }
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
        });
        return;
      }
      void client.invalidateQueries({ queryKey });
    },
  });
}
