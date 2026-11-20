import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { track } from '@/analytics/track';
import { apiRequest } from '@/api/client';
import type { Entitlement } from '@/api/contracts';
import type { ImportChoices, ImportCommitResult, ImportCreated, ImportSession } from '@/api/contracts/outfitImport';
import { fromSource } from '@/api/dataSource';
import { toEntitlement, type EntitlementWire } from '@/api/wire/core';
import {
  toImportCreated,
  toImportResult,
  toImportSession,
  type ImportCommitResultWire,
  type ImportCreatedWire,
  type ImportSessionWire,
} from '@/api/wire/outfitImport';
import { jobPollInterval } from '@/api/jobs';
import { lookKeys } from '@/features/looks/queries';
import { wardrobeKeys } from '@/features/wardrobe/queries';
import { itemRecognitionKey, recognitionRemaining } from '@/features/wardrobe/recognition';
import { clone, fixtureDb } from '@/fixtures/db';
import { ulid } from '@/lib/ids';

import { fixtureCommitImport, fixtureCreateImport, fixtureDiscardImport, fixtureGetImport, fixtureOpenImports } from './fixtures';
import { commitBody, pickerLimit } from './logic';
import { startUploads } from './uploader';

export const importKeys = {
  open: ['tenant', 'outfit-import'] as const,
  session: (id: string) => ['tenant', 'outfit-import', id] as const,
};

/**
 * The plan's photo limit and what a non-member has left (`GET v1/tenant/entitlement` → `outfitImport.maxPhotos`,
 * `itemRecognition`). The picker takes min(limit, left); nothing in the app hard-codes the limit.
 */
export function useImportLimits() {
  const query = useQuery({
    queryKey: itemRecognitionKey,
    queryFn: () =>
      fromSource<Entitlement>(
        'wardrobe',
        () => clone(fixtureDb.entitlement),
        async () => toEntitlement(await apiRequest<EntitlementWire>('v1/tenant/entitlement')),
      ),
  });
  const maxPhotos = query.data?.outfitImportMaxPhotos ?? null;
  const remaining = recognitionRemaining(query.data);
  return {
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
    /** The plan's limit; null until the server sent it (an older server: the session answer brings it). */
    maxPhotos,
    /** Null = unlimited (member) or unknown. */
    remaining,
    /** What the picker may take now. */
    limit: pickerLimit(maxPhotos, remaining),
  };
}

/** Open (not committed) imports, newest first — the entry screen resumes the latest. */
export function useOpenImports() {
  return useQuery({
    queryKey: importKeys.open,
    queryFn: () =>
      fromSource<ImportSession[]>(
        'wardrobe',
        () => fixtureOpenImports(),
        async () => (await apiRequest<ImportSessionWire[]>('v1/tenant/outfit-import')).map(toImportSession),
      ),
  });
}

/** One session; polled while photos are uploaded or processed. */
export function useImportSession(id: string | undefined, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: importKeys.session(id ?? 'none'),
    enabled: Boolean(id) && (options.enabled ?? true),
    queryFn: () =>
      fromSource<ImportSession>(
        'wardrobe',
        () => {
          const session = fixtureGetImport(id ?? '');
          if (!session) throw new Error('import not found');
          return session;
        },
        async () => toImportSession(await apiRequest<ImportSessionWire>(`v1/tenant/outfit-import/${id}`)),
      ),
    refetchInterval: (q) =>
      q.state.data && (q.state.data.status === 'processing' || q.state.data.status === 'uploading') ? jobPollInterval(q.state.dataUpdateCount > 1 ? 3000 : 1500) : false,
  });
}

/**
 * "Fotoğraf seç" → the session (`POST v1/tenant/outfit-import`) → background uploads. Resolves with the session
 * as soon as it exists; the uploads continue on their own (uploader).
 */
export function useStartImport() {
  const client = useQueryClient();
  return useMutation<ImportCreated, unknown, string[]>({
    mutationFn: async (localUris) => {
      const requestId = ulid();
      const created = await fromSource<ImportCreated>(
        'wardrobe',
        () => fixtureCreateImport(requestId, localUris.length),
        async () =>
          toImportCreated(await apiRequest<ImportCreatedWire>('v1/tenant/outfit-import', { method: 'POST', body: { requestId, count: localUris.length } })),
      );
      startUploads(created.session.id, created.session.requested, created.uploads, localUris);
      return created;
    },
    onSuccess: (created) => {
      client.setQueryData(importKeys.session(created.session.id), created.session);
      void client.invalidateQueries({ queryKey: importKeys.open });
    },
    onSettled: () => void client.invalidateQueries({ queryKey: itemRecognitionKey }),
  });
}

/** "Onayla" (31c): the user's choices → items + looks; the wardrobe and looks are read again. */
export function useCommitImport(session: ImportSession | undefined) {
  const client = useQueryClient();
  return useMutation<ImportCommitResult, unknown, ImportChoices>({
    mutationFn: (choices) =>
      fromSource<ImportCommitResult>(
        'wardrobe',
        () => {
          const committed = fixtureCommitImport(session?.id ?? '', choices);
          if (!committed?.result) throw new Error('import not found');
          return committed.result;
        },
        async () =>
          toImportResult(
            await apiRequest<ImportCommitResultWire>(`v1/tenant/outfit-import/${session?.id}/commit`, { method: 'POST', body: session ? commitBody(session, choices) : { looks: [] } }),
          ),
      ),
    onSuccess: (result) => {
      track('outfit_import_commit', { looks: result.createdLookCount, items: result.createdItemCount });
      if (result.createdItemCount > 0) track('item_added', { source: 'import', count: result.createdItemCount });
      void client.invalidateQueries({ queryKey: wardrobeKeys.items });
      void client.invalidateQueries({ queryKey: lookKeys.looks });
      void client.invalidateQueries({ queryKey: importKeys.open });
      if (session) void client.invalidateQueries({ queryKey: importKeys.session(session.id) });
    },
  });
}

/** "Vazgeç": the session and its photos are deleted; unused recognitions come back. */
export function useDiscardImport() {
  const client = useQueryClient();
  return useMutation<void, unknown, string>({
    mutationFn: (id) =>
      fromSource<void>(
        'wardrobe',
        () => fixtureDiscardImport(id),
        async () => {
          await apiRequest<void>(`v1/tenant/outfit-import/${id}`, { method: 'DELETE' });
        },
      ),
    onSettled: (_data, _error, id) => {
      client.removeQueries({ queryKey: importKeys.session(id) });
      void client.invalidateQueries({ queryKey: importKeys.open });
      void client.invalidateQueries({ queryKey: itemRecognitionKey });
    },
  });
}
