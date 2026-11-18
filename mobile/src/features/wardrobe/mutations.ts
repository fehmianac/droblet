import { itemRecognitionKey } from './recognition';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { File, UploadType } from 'expo-file-system';

import { apiRequest } from '@/api/client';
import type {
  ConfirmItemDraftsRequest,
  ConfirmItemDraftsResponse,
  CreateItemDraftsRequest,
  CreateItemDraftsResponse,
  Item,
  ItemDetail,
  ItemDraft,
  ItemFields,
  ItemSeason,
  ItemUploadUrlRequest,
  ItemUploadUrlResponse,
  PutItemRequest,
} from '@/api/contracts/wardrobe';
import { ApiError, isConflict, isGone } from '@/api/errors';
import { DATA_SOURCE, fromSource } from '@/api/dataSource';
import { lookKeys } from '@/features/looks/queries';
import {
  fixtureConfirmDrafts,
  fixtureCreateDrafts,
  fixtureDeleteDraft,
  fixtureDeleteItem,
  fixturePutItem,
  fixtureRetryDraft,
} from '@/fixtures/wardrobe';
import { ulid } from '@/lib/ids';
import { newClientMutation, type ClientMutationMeta } from '@/sync/clientMutation';
import { conflictStore } from '@/sync/conflicts';
import { TENANT_WRITE_SCOPE } from '@/sync/queryKeys';

import { fieldsOf } from './form';
import { wardrobeKeys } from './queries';

/** Mutation keys — every queued write has one so it can resume after an app restart. */
export const wardrobeMutationKeys = {
  putItem: ['tenant', 'item', 'put'] as const,
  deleteItem: ['tenant', 'item', 'delete'] as const,
  confirmDrafts: ['tenant', 'item-draft', 'confirm'] as const,
  discardDraft: ['tenant', 'item-draft', 'delete'] as const,
};

export type PutItemVariables = ClientMutationMeta & { id: string; fields: ItemFields; baseVersion: number };
export type DeleteItemVariables = ClientMutationMeta & { id: string };
export type ConfirmDraftsVariables = {
  request: ConfirmItemDraftsRequest;
  /** Local preview per new item id, for the optimistic grid tile. */
  previews: Record<string, string | null>;
};
export type DiscardDraftVariables = ClientMutationMeta & { draftId: string };

function patchItem(client: QueryClient, id: string, patch: (item: Item) => Item): void {
  client.setQueryData<Item[]>(wardrobeKeys.items, (prev) => prev?.map((i) => (i.id === id ? patch(i) : i)));
  client.setQueryData<ItemDetail>(wardrobeKeys.item(id), (prev) => (prev ? { ...prev, ...patch(prev) } : prev));
}

function dropItem(client: QueryClient, id: string): void {
  client.setQueryData<Item[]>(wardrobeKeys.items, (prev) => prev?.filter((i) => i.id !== id));
  client.removeQueries({ queryKey: wardrobeKeys.item(id) });
}

/**
 * Registers the function of every queued wardrobe write. Paused mutations are persisted without
 * their function, so a write queued offline resumes after a restart only if its key is registered here.
 */
export function registerWardrobeMutations(client: QueryClient): void {
  const executePut = (vars: PutItemVariables) =>
    client.getMutationCache().build(client, { mutationKey: wardrobeMutationKeys.putItem, scope: TENANT_WRITE_SCOPE }).execute(vars);

  // --- PUT v1/tenant/item/{id} (versioned)
  client.setMutationDefaults(wardrobeMutationKeys.putItem, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: PutItemVariables) => {
      // Writes are sent in order, so an earlier queued edit of the same piece has already moved the
      // cached version on: send the newest version this device knows, not the one captured at tap time.
      const cached = client.getQueryData<Item[]>(wardrobeKeys.items)?.find((i) => i.id === vars.id);
      const body: PutItemRequest = {
        ...vars.fields,
        baseVersion: Math.max(vars.baseVersion, cached?.baseVersion ?? 0),
        clientMutationId: vars.clientMutationId,
      };
      return fromSource<Item>(
        'wardrobe',
        () => fixturePutItem(vars.id, body),
        () => apiRequest<Item>(`v1/tenant/item/${vars.id}`, { method: 'PUT', body }),
      );
    },
    onMutate: async (vars: PutItemVariables) => {
      await client.cancelQueries({ queryKey: wardrobeKeys.items });
      patchItem(client, vars.id, (item) => ({ ...item, ...vars.fields }));
    },
    onSuccess: (saved: Item | undefined, vars: PutItemVariables) => {
      if (saved) patchItem(client, vars.id, (item) => ({ ...item, ...saved }));
      void client.invalidateQueries({ queryKey: lookKeys.looks });
    },
    onError: (error: unknown, vars: PutItemVariables) => {
      if (isConflict(error)) {
        const current = error.problem?.current as Item | undefined;
        conflictStore.push({
          id: vars.clientMutationId,
          kind: 'changed',
          keepTheirs: () => {
            if (current) patchItem(client, vars.id, (item) => ({ ...item, ...current }));
            else void client.invalidateQueries({ queryKey: wardrobeKeys.items });
          },
          keepMine: current ? () => void executePut({ ...vars, baseVersion: current.baseVersion, clientMutationId: ulid() }) : undefined,
        });
        return;
      }
      if (isGone(error)) {
        conflictStore.push({ id: vars.clientMutationId, kind: 'deleted', keepTheirs: () => dropItem(client, vars.id) });
        return;
      }
      void client.invalidateQueries({ queryKey: wardrobeKeys.items });
      void client.invalidateQueries({ queryKey: wardrobeKeys.item(vars.id) });
    },
  });

  // --- DELETE v1/tenant/item/{id}
  client.setMutationDefaults(wardrobeMutationKeys.deleteItem, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: async (vars: DeleteItemVariables) => {
      try {
        await fromSource<void>(
          'wardrobe',
          () => fixtureDeleteItem(vars.id),
          () => apiRequest<void>(`v1/tenant/item/${vars.id}`, { method: 'DELETE' }),
        );
      } catch (error) {
        // Already deleted elsewhere: the user's intent is fulfilled.
        if (!isGone(error)) throw error;
      }
    },
    onMutate: async (vars: DeleteItemVariables) => {
      await client.cancelQueries({ queryKey: wardrobeKeys.items });
      dropItem(client, vars.id);
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: lookKeys.looks }),
    onError: () => void client.invalidateQueries({ queryKey: wardrobeKeys.items }),
  });

  // --- POST v1/tenant/item-draft/confirm (AI drafts after review, and library / manual pieces)
  client.setMutationDefaults(wardrobeMutationKeys.confirmDrafts, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: ConfirmDraftsVariables) =>
      fromSource<ConfirmItemDraftsResponse>(
        'wardrobe',
        () => fixtureConfirmDrafts(vars.request),
        () => apiRequest<ConfirmItemDraftsResponse>('v1/tenant/item-draft/confirm', { method: 'POST', body: vars.request }),
      ),
    onMutate: async (vars: ConfirmDraftsVariables) => {
      await client.cancelQueries({ queryKey: wardrobeKeys.items });
      await client.cancelQueries({ queryKey: wardrobeKeys.drafts });
      const now = new Date().toISOString();
      const optimistic = vars.request.items.map((entry): Item => {
        const { draftId: _d, libraryItemId: _l, reviewed: _r, clientMutationId: _c, ...fields } = entry;
        void [_d, _l, _r, _c];
        const preview = vars.previews[entry.id] ?? null;
        return { ...fields, imageUrl: preview, originalImageUrl: preview, wearCount: 0, lastWornAt: null, createdAt: now, baseVersion: 0 };
      });
      client.setQueryData<Item[]>(wardrobeKeys.items, (prev) => {
        const known = new Set((prev ?? []).map((i) => i.id));
        return [...optimistic.filter((i) => !known.has(i.id)), ...(prev ?? [])];
      });
      const confirmed = new Set(vars.request.items.map((i) => i.draftId));
      client.setQueryData<ItemDraft[]>(wardrobeKeys.drafts, (prev) => prev?.filter((d) => !confirmed.has(d.id)));
    },
    onSuccess: (saved: ConfirmItemDraftsResponse | undefined) => {
      if (!saved) return;
      const byId = new Map(saved.items.map((i) => [i.id, i]));
      client.setQueryData<Item[]>(wardrobeKeys.items, (prev) => prev?.map((i) => byId.get(i.id) ?? i));
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: wardrobeKeys.items });
      void client.invalidateQueries({ queryKey: wardrobeKeys.drafts });
    },
  });

  // --- DELETE v1/tenant/item-draft/{id}
  client.setMutationDefaults(wardrobeMutationKeys.discardDraft, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: async (vars: DiscardDraftVariables) => {
      try {
        await fromSource<void>(
          'wardrobe',
          () => fixtureDeleteDraft(vars.draftId),
          () => apiRequest<void>(`v1/tenant/item-draft/${vars.draftId}`, { method: 'DELETE' }),
        );
      } catch (error) {
        if (!isGone(error)) throw error;
      }
    },
    onMutate: async (vars: DiscardDraftVariables) => {
      await client.cancelQueries({ queryKey: wardrobeKeys.drafts });
      client.setQueryData<ItemDraft[]>(wardrobeKeys.drafts, (prev) => prev?.filter((d) => d.id !== vars.draftId));
    },
    onError: () => void client.invalidateQueries({ queryKey: wardrobeKeys.drafts }),
  });
}

// ---------- hooks ----------

/** Edit a piece (12c edit mode, "Sezonu değiştir"). Optimistic; queued while offline. */
export function useUpdateItem() {
  const m = useMutation<Item, unknown, PutItemVariables>({ mutationKey: wardrobeMutationKeys.putItem });
  return {
    ...m,
    update: (item: Pick<Item, 'id' | 'baseVersion'>, fields: ItemFields) =>
      m.mutate({ id: item.id, fields, baseVersion: item.baseVersion, ...newClientMutation() }),
    /** Season change for one or many pieces (11 menu, 10 multi-select): one queued write per piece. */
    setSeasons: (items: Item[], seasons: ItemSeason[]) =>
      items.forEach((item) =>
        m.mutate({ id: item.id, fields: { ...fieldsOf(item), seasons }, baseVersion: item.baseVersion, ...newClientMutation() }),
      ),
  };
}

/** Delete pieces ("Gardıroptan sil", multi-select "Sil"). Optimistic; one queued write per piece. */
export function useDeleteItems() {
  const m = useMutation<void, unknown, DeleteItemVariables>({ mutationKey: wardrobeMutationKeys.deleteItem });
  return { ...m, remove: (ids: string[]) => ids.forEach((id) => m.mutate({ id, ...newClientMutation() })) };
}

export type NewItemInput = { fields: ItemFields; draftId: string | null; libraryItemId?: string | null; preview?: string | null; reviewed?: boolean };

/** Builds the confirm request; ids and mutation ids are created here, at user-action time. */
export function buildConfirmVariables(inputs: NewItemInput[]): ConfirmDraftsVariables {
  const previews: Record<string, string | null> = {};
  const items = inputs.map((input) => {
    const id = ulid();
    previews[id] = input.preview ?? null;
    return {
      ...input.fields,
      id,
      draftId: input.draftId,
      libraryItemId: input.libraryItemId ?? null,
      reviewed: input.reviewed ?? true,
      clientMutationId: ulid(),
    };
  });
  return { request: { items }, previews };
}

/** "Gardıroba kaydet" / "N parçayı gardıroba ekle" / library add. Nothing is saved without this user action. */
export function useAddItems() {
  const m = useMutation<ConfirmItemDraftsResponse, unknown, ConfirmDraftsVariables>({ mutationKey: wardrobeMutationKeys.confirmDrafts });
  return { ...m, add: (inputs: NewItemInput[]) => m.mutate(buildConfirmVariables(inputs)) };
}

export function useDiscardDraft() {
  const m = useMutation<void, unknown, DiscardDraftVariables>({ mutationKey: wardrobeMutationKeys.discardDraft });
  return { ...m, discard: (draftId: string) => m.mutate({ draftId, ...newClientMutation() }) };
}

async function uploadItemPhotos(localUris: string[]): Promise<string[]> {
  const request: ItemUploadUrlRequest = { count: localUris.length, contentType: 'image/jpeg' };
  // Presigned URLs are requested at send time — they expire.
  const { uploads } = await apiRequest<ItemUploadUrlResponse>('v1/tenant/item/upload-url', { method: 'POST', body: request });
  await Promise.all(
    localUris.map(async (uri, i) => {
      const target = uploads[i];
      if (!target) throw new ApiError('http', 500, null);
      const result = await new File(uri).upload(target.uploadUrl, {
        httpMethod: 'PUT',
        uploadType: UploadType.BINARY_CONTENT,
        headers: { 'Content-Type': 'image/jpeg' },
      });
      if (result.status < 200 || result.status >= 300) throw new ApiError('http', result.status, null);
    }),
  );
  return uploads.slice(0, localUris.length).map((u) => u.photoKey);
}

export type StartDraftsVariables = { requestId: string; localUris: string[]; splitOutfit: boolean };

/**
 * Uploads item photos and starts one ItemProcessor job per photo (12, 13). NOT queued: AI processing
 * needs a connection, so screens check connectivity first and say so. `requestId` is created once
 * per user action, so a retried request opens the same drafts.
 */
export function useStartItemDrafts() {
  const client = useQueryClient();
  const m = useMutation<CreateItemDraftsResponse, unknown, StartDraftsVariables>({
    mutationFn: async (vars) => {
      // Fixture mode: nothing is uploaded; the local file is the draft's picture.
      const photoKeys = DATA_SOURCE.wardrobe === 'api' ? await uploadItemPhotos(vars.localUris) : vars.localUris;
      const body: CreateItemDraftsRequest = { requestId: vars.requestId, photoKeys, splitOutfit: vars.splitOutfit };
      return fromSource<CreateItemDraftsResponse>(
        'wardrobe',
        () => fixtureCreateDrafts(body),
        () => apiRequest<CreateItemDraftsResponse>('v1/tenant/item-draft', { method: 'POST', body }),
      );
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: wardrobeKeys.drafts }),
    // Each recognition (and a 402) changes the free quota.
    onSettled: () => void client.invalidateQueries({ queryKey: itemRecognitionKey }),
  });
  return {
    ...m,
    start: (localUris: string[], splitOutfit = false) => m.mutateAsync({ requestId: ulid(), localUris, splitOutfit }),
  };
}

/** "Tekrar dene" on a failed draft. Needs a connection (not queued). */
export function useRetryDraft() {
  const client = useQueryClient();
  return useMutation<void, unknown, string>({
    mutationFn: (draftId) =>
      fromSource<void>(
        'wardrobe',
        () => fixtureRetryDraft(draftId),
        () => apiRequest<void>(`v1/tenant/item-draft/${draftId}/retry`, { method: 'POST' }),
      ),
    onSettled: () => void client.invalidateQueries({ queryKey: wardrobeKeys.drafts }),
  });
}
