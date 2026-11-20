import { isRecognitionLimitReached, itemRecognitionKey } from './recognition';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { track } from '@/analytics/track';
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
  PutItemRequest,
} from '@/api/contracts/wardrobe';
import { ApiError, isConflict, isGone } from '@/api/errors';
import {
  fromItemFields,
  toItem,
  type ConfirmDraftRowWire,
  type CreateItemWire,
  type CreateItemDraftsResultWire,
  type CreateItemDraftsWire,
  type FromLibraryRowWire,
  type ItemCreateResultWire,
  type ItemCreateResultsWire,
  type ItemUploadsWire,
  type ItemWire,
  type PutItemWire,
} from '@/api/wire/wardrobe';
import { DATA_SOURCE, fromSource } from '@/api/dataSource';
import { lookKeys } from '@/features/looks/queries';
import {
  fixtureConfirmDrafts,
  fixtureCreateDrafts,
  fixtureDeleteDraft,
  fixtureDeleteItem,
  fixturePutItem,
  fixtureRetryDraft,
  fixtureSelectDetected,
} from '@/fixtures/wardrobe';
import { ulid } from '@/lib/ids';
import { newClientMutation, type ClientMutationMeta } from '@/sync/clientMutation';
import { isModerationOnlyChange } from '@/features/moderation/logic';
import { conflictStore } from '@/sync/conflicts';
import { postToPresigned } from '@/sync/photoUpload';
import { TENANT_WRITE_SCOPE } from '@/sync/queryKeys';

import { detectedEdits } from './detect';
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
  /**
   * New item id → local photo of a piece entered without AI (the photo taken before the free recognition
   * quota ran out). Uploaded when the write is sent — presigned URLs expire — and passed on as `photoKey`.
   */
  photos?: Record<string, string>;
};
export type DiscardDraftVariables = ClientMutationMeta & { draftId: string };

function currentItem(error: ApiError): Item | undefined {
  const current = error.current as (ItemWire & Partial<Item>) | null;
  if (!current) return undefined;
  return 'version' in current ? toItem(current) : (current as unknown as Item);
}

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
        async () => {
          // PUT v1/tenant/item/{id}: all user fields are replaced; 409 → the current ItemDto.
          const wire: PutItemWire = { ...fromItemFields(vars.fields, cached?.colorIds), baseVersion: body.baseVersion };
          return toItem(await apiRequest<ItemWire>(`v1/tenant/item/${vars.id}`, { method: 'PUT', body: wire }));
        },
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
        // Fixtures answer `{ current }` in the app shape; the API answers the current ItemDto itself.
        const current = currentItem(error);
        const mine = client.getQueryData<Item[]>(wardrobeKeys.items)?.find((i) => i.id === vars.id);
        if (current && isModerationOnlyChange(mine, current)) {
          patchItem(client, vars.id, (item) => ({ ...item, moderation: current.moderation ?? null }));
          void executePut({ ...vars, baseVersion: current.baseVersion, clientMutationId: ulid() });
          return;
        }
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
    mutationFn: async (vars: ConfirmDraftsVariables) => {
      const request = await withManualPhotos(vars);
      return fromSource<ConfirmItemDraftsResponse>(
        'wardrobe',
        () => fixtureConfirmDrafts(request),
        () => confirmOnApi(request),
      );
    },
    onMutate: async (vars: ConfirmDraftsVariables) => {
      await client.cancelQueries({ queryKey: wardrobeKeys.items });
      await client.cancelQueries({ queryKey: wardrobeKeys.drafts });
      const now = new Date().toISOString();
      const optimistic = vars.request.items.map((entry): Item => {
        const { draftId: _d, libraryItemId: _l, reviewed: _r, clientMutationId: _c, photoKey: _p, ...fields } = entry;
        void [_d, _l, _r, _c, _p];
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
    onSuccess: (saved: ConfirmItemDraftsResponse | undefined, vars: ConfirmDraftsVariables) => {
      if (!saved) return;
      const byId = new Map(saved.items.map((i) => [i.id, i]));
      // A row the server rejected (draft gone / not ready, validation) is not in the wardrobe: its
      // optimistic tile is removed and the draft list is read again so the draft is back for review.
      const rejected = new Set(vars.request.items.map((i) => i.id).filter((id) => !byId.has(id)));
      client.setQueryData<Item[]>(wardrobeKeys.items, (prev) => prev?.filter((i) => !rejected.has(i.id)).map((i) => byId.get(i.id) ?? i));
      if (rejected.size > 0) void client.invalidateQueries({ queryKey: wardrobeKeys.drafts });
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

export type NewItemInput = {
  fields: ItemFields;
  draftId: string | null;
  libraryItemId?: string | null;
  preview?: string | null;
  reviewed?: boolean;
  /** Manual entry only: the local photo to save with the piece (see `ConfirmDraftsVariables.photos`). */
  photoUri?: string | null;
};

/** Builds the confirm request; ids and mutation ids are created here, at user-action time. */
export function buildConfirmVariables(inputs: NewItemInput[]): ConfirmDraftsVariables {
  const previews: Record<string, string | null> = {};
  const photos: Record<string, string> = {};
  const items = inputs.map((input) => {
    const id = ulid();
    const photoUri = input.draftId ? null : (input.photoUri ?? null);
    if (photoUri) photos[id] = photoUri;
    previews[id] = input.preview ?? photoUri;
    return {
      ...input.fields,
      id,
      draftId: input.draftId,
      libraryItemId: input.libraryItemId ?? null,
      reviewed: input.reviewed ?? true,
      clientMutationId: ulid(),
    };
  });
  return Object.keys(photos).length > 0 ? { request: { items }, previews, photos } : { request: { items }, previews };
}

/**
 * Keeps the own photo of every manual entry. Runs when the write is sent (also after an offline wait or an
 * app restart), so the upload URL is always fresh. Real API: the photos are uploaded and turned into
 * manual drafts (`POST v1/tenant/item-draft { manual: true }` — no AI, no allowance), and the entries are
 * confirmed through those drafts. Fixture mode: nothing is uploaded; the local file is the `photoKey`.
 */
export async function withManualPhotos(vars: ConfirmDraftsVariables): Promise<ConfirmItemDraftsRequest> {
  const entries = Object.entries(vars.photos ?? {});
  if (entries.length === 0) return vars.request;
  const uris = entries.map(([, uri]) => uri);
  if (DATA_SOURCE.wardrobe === 'api') {
    const draftIds = await startManualDrafts(await uploadItemPhotos(uris));
    const draftById = new Map(entries.map(([id], i) => [id, draftIds[i] ?? null]));
    return { items: vars.request.items.map((item) => (draftById.get(item.id) ? { ...item, draftId: draftById.get(item.id) ?? null } : item)) };
  }
  const keyById = new Map(entries.map(([id], i) => [id, uris[i] ?? null]));
  return { items: vars.request.items.map((item) => (keyById.get(item.id) ? { ...item, photoKey: keyById.get(item.id) } : item)) };
}

/** Where saved pieces came from (analytics `item_added`). */
export type ItemAddSource = 'photo' | 'manual' | 'library' | 'bulk' | 'import';

/** "Gardıroba kaydet" / "N parçayı gardıroba ekle" / library add. Nothing is saved without this user action. */
export function useAddItems() {
  const m = useMutation<ConfirmItemDraftsResponse, unknown, ConfirmDraftsVariables>({ mutationKey: wardrobeMutationKeys.confirmDrafts });
  return {
    ...m,
    add: (inputs: NewItemInput[], source: ItemAddSource) => {
      m.mutate(buildConfirmVariables(inputs));
      if (inputs.length > 0) track('item_added', { source, count: inputs.length });
    },
  };
}

export function useDiscardDraft() {
  const m = useMutation<void, unknown, DiscardDraftVariables>({ mutationKey: wardrobeMutationKeys.discardDraft });
  return { ...m, discard: (draftId: string) => m.mutate({ draftId, ...newClientMutation() }) };
}

/**
 * `POST v1/tenant/item/upload-url { count, contentType }` → one presigned S3 POST per photo, then each
 * photo is sent as a multipart form (fields first, file last). Returns the `uploadId`s in photo order.
 */
export async function uploadItemPhotos(localUris: string[]): Promise<string[]> {
  const request: ItemUploadUrlRequest = { count: localUris.length, contentType: 'image/jpeg' };
  // Presigned forms are requested at send time — they expire.
  const { uploads } = await apiRequest<ItemUploadsWire>('v1/tenant/item/upload-url', { method: 'POST', body: request });
  await Promise.all(
    localUris.map(async (uri, i) => {
      const target = uploads[i];
      if (!target) throw new ApiError('http', 500, null);
      const status = await postToPresigned(uri, target);
      if (status < 200 || status >= 300) throw new ApiError('http', status, null);
    }),
  );
  return uploads.slice(0, localUris.length).map((u) => u.uploadId);
}

function toDraftsResponse(requestId: string, wire: CreateItemDraftsResultWire): CreateItemDraftsResponse {
  const confirmable = wire.drafts.filter((d) => d.kind !== 'outfit');
  return {
    jobId: wire.jobs[0]?.id ?? requestId,
    draftIds: (confirmable.length > 0 ? confirmable : wire.drafts).map((d) => d.id),
    ...(wire.skippedCount > 0 ? { skippedCount: wire.skippedCount } : {}),
  };
}

function postDrafts(body: CreateItemDraftsWire): Promise<CreateItemDraftsResultWire> {
  return apiRequest<CreateItemDraftsResultWire>('v1/tenant/item-draft', { method: 'POST', body });
}

/**
 * The uploaded photos as manual drafts (`manual: true`): no AI, no allowance, immediately `ready`
 * with empty fields — the user fills the form (12c) and confirms as usual.
 */
async function startManualDrafts(uploadIds: string[]): Promise<string[]> {
  if (uploadIds.length === 0) return [];
  const res = await postDrafts({ requestId: ulid(), uploadIds, splitOutfit: false, manual: true });
  return res.drafts.map((d) => d.id);
}

/**
 * Thrown when the recognition allowance refused the request (402 `item_recognition_limit_reached`,
 * 403 `premium_required`). The photos are already uploaded and were turned into manual drafts, so
 * "Elle gir" continues with `manualDraftIds` instead of asking for the photo again.
 */
export class RecognitionLimitError extends ApiError {
  readonly manualDraftIds: string[];
  constructor(cause: ApiError, manualDraftIds: string[]) {
    super('http', cause.status, cause.problem);
    this.manualDraftIds = manualDraftIds;
  }
}

async function startDraftsOnApi(vars: StartDraftsVariables): Promise<CreateItemDraftsResponse> {
  const uploadIds = await uploadItemPhotos(vars.localUris);
  if (vars.manual) {
    return { jobId: vars.requestId, draftIds: await startManualDrafts(uploadIds) };
  }
  let wire: CreateItemDraftsResultWire;
  try {
    wire = await postDrafts({ requestId: vars.requestId, uploadIds, splitOutfit: vars.splitOutfit, manual: false });
  } catch (error) {
    if (!(error instanceof ApiError) || !isRecognitionLimitReached(error)) throw error;
    const manualDraftIds = await startManualDrafts(uploadIds).catch(() => []);
    throw new RecognitionLimitError(error, manualDraftIds);
  }
  // Photos beyond the remaining allowance were left untouched: they become manual drafts.
  const skipped = wire.skippedUploadIds ?? [];
  if (skipped.length > 0) await startManualDrafts(skipped).catch(() => []);
  return toDraftsResponse(vars.requestId, wire);
}

/**
 * Confirm request → the three endpoints behind it:
 * - rows with a `draftId` → `POST v1/tenant/item-draft/confirm` (the user's final values; item id = `itemId`),
 * - rows with a `libraryItemId` → `POST v1/tenant/item/from-library` (item id = `itemId`),
 * - rows with neither (manual entry without a photo) → `POST v1/tenant/item`, one call per row.
 * Each answers per-row results (`created` | `alreadyApplied` | `rejected` + `code`); only the items
 * that exist afterwards are returned.
 */
async function confirmOnApi(request: ConfirmItemDraftsRequest): Promise<ConfirmItemDraftsResponse> {
  const draftRows: ConfirmDraftRowWire[] = [];
  const libraryRows: FromLibraryRowWire[] = [];
  const manualRows: CreateItemWire[] = [];
  request.items.forEach((entry) => {
    if (entry.draftId) {
      draftRows.push({
        ...fromItemFields(entry),
        draftId: entry.draftId,
        clientMutationId: entry.clientMutationId,
        reviewed: entry.reviewed,
        itemId: entry.id,
      });
    } else if (entry.libraryItemId) {
      // The item id is `itemId ?? clientMutationId`: both carry the device's id, so the optimistic tile matches either way.
      libraryRows.push({ clientMutationId: entry.id, libraryItemId: entry.libraryItemId, size: entry.size, itemId: entry.id });
    } else {
      manualRows.push(toCreateItemWire(entry));
    }
  });
  const [fromDrafts, fromLibrary, manual] = await Promise.all([
    draftRows.length > 0
      ? apiRequest<ItemCreateResultsWire>('v1/tenant/item-draft/confirm', { method: 'POST', body: { items: draftRows } })
      : null,
    libraryRows.length > 0
      ? apiRequest<ItemCreateResultsWire>('v1/tenant/item/from-library', { method: 'POST', body: { items: libraryRows } })
      : null,
    Promise.all(manualRows.map((row) => apiRequest<ItemCreateResultWire>('v1/tenant/item', { method: 'POST', body: row }))),
  ]);
  const items = [...(fromDrafts?.results ?? []), ...(fromLibrary?.results ?? []), ...manual]
    .filter((r) => r.outcome !== 'rejected' && r.item)
    .map((r) => toItem(r.item as ItemWire));
  return { items };
}

/** A manual row → `POST v1/tenant/item`. The device's item id is both `itemId` and `clientMutationId`, so a replay matches. */
export function toCreateItemWire(entry: ConfirmItemDraftsRequest['items'][number]): CreateItemWire {
  const { useOriginalImage: _u, ...fields } = fromItemFields(entry);
  void _u;
  return { ...fields, clientMutationId: entry.id, itemId: entry.id };
}

export type StartDraftsVariables = { requestId: string; localUris: string[]; splitOutfit: boolean; manual?: boolean };

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
      const body: CreateItemDraftsRequest = { requestId: vars.requestId, photoKeys: vars.localUris, splitOutfit: vars.splitOutfit };
      return fromSource<CreateItemDraftsResponse>(
        'wardrobe',
        () => fixtureCreateDrafts(body),
        // upload-url → S3 POST → POST v1/tenant/item-draft (202)
        () => startDraftsOnApi(vars),
      );
    },
    // Also after a refused request: the photos may have become manual drafts.
    onSettled: () => void client.invalidateQueries({ queryKey: wardrobeKeys.drafts }),
    // Each recognition (and a 402) changes the free quota.
    onSuccess: () => void client.invalidateQueries({ queryKey: itemRecognitionKey }),
    onError: () => void client.invalidateQueries({ queryKey: itemRecognitionKey }),
  });
  return {
    ...m,
    start: (localUris: string[], splitOutfit = false) => m.mutateAsync({ requestId: ulid(), localUris, splitOutfit }),
    /** "Elle gir" with a photo: no AI and no allowance, the drafts are ready at once with empty fields. */
    startManual: (localUris: string[]) => m.mutateAsync({ requestId: ulid(), localUris, splitOutfit: false, manual: true }),
  };
}

export type SelectDetectedVariables = { groupId: string; draftIds: string[] };

/** One `edits` row of the selection: the user's values for a piece edited in 12c before it was kept. */
export function toDetectedEditWire(draftId: string, fields: ItemFields) {
  const wire = fromItemFields(fields);
  return { draftId, name: wire.name, category: wire.category, subcategory: wire.subcategory, colorIds: wire.colorIds, fabric: wire.fabric, seasons: wire.seasons };
}

/**
 * "N parçayı ekle" in the chooser: `POST v1/tenant/item-draft/{groupId}/select { draftIds, edits }` → 202.
 * The kept pieces go to background removal (no recognition is used); every other piece of the photo is
 * discarded on the server. Needs a connection (not queued) — the screen checks first.
 */
export function useSelectDetected() {
  const client = useQueryClient();
  return useMutation<void, unknown, SelectDetectedVariables>({
    mutationFn: (vars) =>
      fromSource<void>(
        'wardrobe',
        () => fixtureSelectDetected(vars.groupId, vars.draftIds),
        async () => {
          const edits = vars.draftIds.flatMap((id) => {
            const fields = detectedEdits.get(id);
            return fields ? [toDetectedEditWire(id, fields)] : [];
          });
          await apiRequest<unknown>(`v1/tenant/item-draft/${vars.groupId}/select`, { method: 'POST', body: { draftIds: vars.draftIds, edits } });
        },
      ),
    onSuccess: (_data, vars) => detectedEdits.clear(vars.draftIds),
    onSettled: () => void client.invalidateQueries({ queryKey: wardrobeKeys.drafts }),
  });
}

/** "Tekrar dene" on a failed draft. Needs a connection (not queued). */
export function useRetryDraft() {
  const client = useQueryClient();
  return useMutation<void, unknown, string>({
    mutationFn: (draftId) =>
      fromSource<void>(
        'wardrobe',
        () => fixtureRetryDraft(draftId),
        // POST v1/tenant/item-draft/{id}/retry → 202 (same body as POST item-draft); the list is read again.
        async () => {
          await apiRequest<unknown>(`v1/tenant/item-draft/${draftId}/retry`, { method: 'POST' });
        },
      ),
    onSettled: () => void client.invalidateQueries({ queryKey: wardrobeKeys.drafts }),
  });
}
