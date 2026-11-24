import type { QueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type { CreateLookRequest, FeedShareRequest, Look, PutLookRequest } from '@/api/contracts/looks';
import { ApiError, isConflict, isGone } from '@/api/errors';
import {
  fromOccasion,
  fromSlotInput,
  toLookAsync,
  type CreateLookWire,
  type LookSourceWire,
  type LookWire,
  type PutLookWire,
} from '@/api/wire/wardrobe';
import { fromSource } from '@/api/dataSource';
import { registerTripMutations } from '@/features/trips/mutations';
import { clone, fixtureDb } from '@/fixtures/db';
import { toast } from '@/components/ui/toast';
import { fixtureCreateLook, fixtureDeleteLook, fixturePutLook, fixtureSetFeedShare } from '@/fixtures/looks';
import i18n from '@/i18n';
import { ulid } from '@/lib/ids';
import { isModerationOnlyChange } from '@/features/moderation/logic';
import { conflictStore } from '@/sync/conflicts';
import { TENANT_WRITE_SCOPE } from '@/sync/queryKeys';

import { lookKeys } from './queries';

/** Mutation keys — every queued write has one so it can resume after an app restart. */
export const lookMutationKeys = {
  create: ['tenant', 'look', 'create'] as const,
  put: ['tenant', 'look', 'put'] as const,
  remove: ['tenant', 'look', 'delete'] as const,
  feedShare: ['tenant', 'look', 'feed-share'] as const,
};

/** The server's reasons for refusing "Akışta paylaş" that have their own calm sentence (`feedShare.errors.*`). */
export const FEED_SHARE_ERROR_CODES = ['email_not_verified', 'handle_required', 'look_not_shareable', 'teen_restricted', 'too_many_attempts'] as const;
export type FeedShareErrorCode = (typeof FEED_SHARE_ERROR_CODES)[number];

/** Which sentence a failed feed-share write shows. */
export function feedShareErrorKey(error: unknown, shared: boolean): FeedShareErrorCode | 'shareFailed' | 'removeFailed' {
  const code = error instanceof ApiError ? error.code : null;
  if (code && (FEED_SHARE_ERROR_CODES as readonly string[]).includes(code)) return code as FeedShareErrorCode;
  if (error instanceof ApiError && error.status === 429) return 'too_many_attempts';
  return shared ? 'shareFailed' : 'removeFailed';
}

/** The look as "Akışta paylaş" leaves it: on keeps what it already got (or starts at zero), off drops the numbers. */
export function withFeedShare(look: Look, shared: boolean): Look {
  return { ...look, sharedToFeed: shared, feedStats: shared ? (look.feedStats ?? { likeCount: 0, saveCount: 0 }) : null };
}

function patchLook(client: QueryClient, id: string, change: (look: Look) => Look): void {
  client.setQueryData<Look[]>(lookKeys.looks, (prev) => prev?.map((l) => (l.id === id ? change(l) : l)));
  client.setQueryData<Look>(lookKeys.look(id), (prev) => (prev ? change(prev) : prev));
}

/** `optimistic` is what the cache shows until the server answers; only `request` goes over the wire. */
/** `source` (default `user`) says where the look came from: `builder` (23), `edit` (08). `stylist` is set by the server. */
export type CreateLookVariables = { request: CreateLookRequest; optimistic: Look; source?: LookSourceWire };
export type PutLookVariables = { id: string; request: PutLookRequest; optimistic: Look };
export type DeleteLookVariables = { id: string; clientMutationId: string };

/** Fixtures answer `{ current }` in the app shape; the API answers the current LookDto itself. */
async function currentLook(error: ApiError): Promise<Look | undefined> {
  const current = error.current as (LookWire & Partial<Look>) | null;
  if (!current) return undefined;
  if (!('version' in current)) return current as unknown as Look;
  try {
    return await toLookAsync(current);
  } catch {
    return undefined;
  }
}

function upsert(list: Look[] | undefined, look: Look): Look[] | undefined {
  if (!list) return list;
  return list.some((l) => l.id === look.id) ? list.map((l) => (l.id === look.id ? look : l)) : [look, ...list];
}

/** The look's pieces, order-free: two looks with the same key show the same cover. */
export const pieceKey = (look: Pick<Look, 'slots'>) => look.slots.map((s) => `${s.slot}:${s.source}:${s.refId}`).sort().join('|');

/**
 * The look a write answered, with the cover the cache already shows: POST / PUT answers carry no presigned cover URL
 * (only GET does), so a favourite or rename must not drop it. A change of pieces does: the old cover shows other pieces.
 */
export function withKnownCover(saved: Look, known: Look | undefined): Look {
  if (saved.coverImageUrl || !known?.coverImageUrl || pieceKey(known) !== pieceKey(saved)) return saved;
  return { ...saved, coverImageUrl: known.coverImageUrl };
}

function writeSaved(client: QueryClient, saved: Look): void {
  writeLook(client, withKnownCover(saved, client.getQueryData<Look>(lookKeys.look(saved.id)) ?? client.getQueryData<Look[]>(lookKeys.looks)?.find((l) => l.id === saved.id)));
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
        async () => {
          // POST v1/tenant/look → 201, or 200 when the same id was sent before (replay-safe).
          const body: CreateLookWire = {
            id: vars.request.id,
            name: vars.request.name,
            occasion: fromOccasion(vars.request.occasion),
            slots: vars.request.slots.map(fromSlotInput),
            favorite: vars.optimistic.isFavorite,
            source: vars.source ?? 'user',
          };
          return toLookAsync(await apiRequest<LookWire>('v1/tenant/look', { method: 'POST', body }));
        },
      ),
    onMutate: async (vars: CreateLookVariables) => {
      await client.cancelQueries({ queryKey: lookKeys.looks });
      writeLook(client, vars.optimistic);
    },
    onSuccess: (saved: Look | undefined) => {
      if (saved) writeSaved(client, saved);
    },
    // The editor has already closed: a refused save must say so, not just vanish from the list.
    onError: () => {
      invalidate();
      toast.error(i18n.t('lookEditor.saveFailed'), { testID: 'toast-look-save-error' });
    },
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
        async () => {
          // PUT v1/tenant/look/{id} → 409 with the current LookDto · 422 slot rule codes.
          const body: PutLookWire = {
            name: request.name,
            occasion: fromOccasion(request.occasion),
            slots: request.slots.map(fromSlotInput),
            favorite: request.isFavorite,
            baseVersion: request.baseVersion,
          };
          return toLookAsync(await apiRequest<LookWire>(`v1/tenant/look/${vars.id}`, { method: 'PUT', body }));
        },
      );
    },
    onMutate: async (vars: PutLookVariables) => {
      await client.cancelQueries({ queryKey: lookKeys.looks });
      // Keep the server's version number: the optimistic copy must not pretend to be saved.
      writeLook(client, vars.optimistic);
    },
    onSuccess: (saved: Look | undefined) => {
      if (saved) writeSaved(client, saved);
    },
    onError: async (error: unknown, vars: PutLookVariables) => {
      if (isConflict(error)) {
        const current = await currentLook(error);
        if (current && isModerationOnlyChange(vars.optimistic, current)) {
          writeLook(client, { ...vars.optimistic, moderation: current.moderation ?? null, baseVersion: current.baseVersion });
          rerun<PutLookVariables>(lookMutationKeys.put, {
            ...vars,
            optimistic: { ...vars.optimistic, moderation: current.moderation ?? null, baseVersion: current.baseVersion },
            request: { ...vars.request, baseVersion: current.baseVersion, clientMutationId: ulid() },
          });
          return;
        }
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

  // PUT (share) / DELETE (remove) v1/tenant/look/{id}/feed-share → 204 (Akış F2, decision 21)
  client.setMutationDefaults(lookMutationKeys.feedShare, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: FeedShareRequest) =>
      fromSource<void>(
        'wardrobe',
        () => fixtureSetFeedShare(vars.id, vars.shared),
        () => apiRequest<void>(`v1/tenant/look/${encodeURIComponent(vars.id)}/feed-share`, { method: vars.shared ? 'PUT' : 'DELETE' }),
      ),
    onMutate: async (vars: FeedShareRequest) => {
      await client.cancelQueries({ queryKey: lookKeys.looks });
      patchLook(client, vars.id, (l) => withFeedShare(l, vars.shared));
    },
    onError: (error: unknown, vars: FeedShareRequest) => {
      // Removing a look that is already gone from Akış (or deleted) is the outcome the user wanted.
      if (!vars.shared && isGone(error)) return;
      // Back to what it was — unless a newer toggle already changed it again.
      patchLook(client, vars.id, (l) => (Boolean(l.sharedToFeed) === vars.shared ? withFeedShare(l, !vars.shared) : l));
      toast.error(i18n.t(`feedShare.errors.${feedShareErrorKey(error, vars.shared)}`), { testID: 'toast-feed-share-error' });
      invalidate();
      void client.invalidateQueries({ queryKey: lookKeys.look(vars.id) });
    },
  });

  registerTripMutations(client);
}

/**
 * Heart on a look from anywhere (06 Bugün, 14, 15): the favourite flag is part of the versioned look,
 * so this is `PUT v1/tenant/look/{id}` with the look's current fields and `favorite` changed. Goes
 * through the same queued, optimistic write as every other look edit. Resolves false when the look
 * is not known on this device and cannot be read.
 */
export async function setLookFavorite(client: QueryClient, lookId: string, favorite: boolean): Promise<boolean> {
  let look = client.getQueryData<Look>(lookKeys.look(lookId)) ?? client.getQueryData<Look[]>(lookKeys.looks)?.find((l) => l.id === lookId);
  if (!look) {
    try {
      look = await fromSource<Look>(
        'wardrobe',
        () => {
          const found = fixtureDb.looks.find((l) => l.id === lookId);
          if (!found) throw new ApiError('http', 404, null);
          return clone(found);
        },
        async () => toLookAsync(await apiRequest<LookWire>(`v1/tenant/look/${lookId}`)),
      );
    } catch {
      return false;
    }
  }
  if (look.isFavorite === favorite) return true;
  const vars: PutLookVariables = {
    id: look.id,
    request: {
      name: look.name,
      occasion: look.occasion,
      slots: look.slots.filter((s) => !s.deleted).map(({ slot, source, refId }) => ({ slot, source, refId })),
      isFavorite: favorite,
      baseVersion: look.baseVersion,
      clientMutationId: ulid(),
    },
    optimistic: { ...look, isFavorite: favorite },
  };
  void client
    .getMutationCache()
    .build(client, { mutationKey: lookMutationKeys.put, scope: TENANT_WRITE_SCOPE })
    .execute(vars)
    .catch(() => undefined);
  return true;
}
