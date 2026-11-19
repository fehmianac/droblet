import { useSyncExternalStore } from 'react';

import { apiRequest } from '@/api/client';
import type { ImportUpload } from '@/api/contracts/outfitImport';
import { DATA_SOURCE } from '@/api/dataSource';
import { ApiError } from '@/api/errors';
import type { ImportCreatedWire, ImportSessionWire } from '@/api/wire/outfitImport';
import { deleteLocalPhoto } from '@/features/photos/preparePhoto';
import { postToPresigned } from '@/sync/photoUpload';

import { fixtureMarkUploaded } from './fixtures';

/**
 * Background uploads of an import (31b): the photos go one by one (two at a time) to their presigned slots, each
 * with its own retries, and every finished upload is confirmed (`POST …/photos/{n}/uploaded`) so the server starts
 * on photo 1 while photo 30 is still on its way. Lives outside React: leaving the screen does not stop it. An
 * expired presigned form (403) is replaced by asking for the session again with the same request id. The local
 * copy is deleted once the server confirmed the photo.
 */
export type UploadStatus = 'queued' | 'uploading' | 'done' | 'failed';
export type PhotoUpload = { index: number; localUri: string; status: UploadStatus };

const ATTEMPTS = 3;
const PARALLEL = 2;
const BACKOFF_MS = [0, 1500, 4000];

type Run = { sessionId: string; requested: number; uploads: PhotoUpload[]; slots: Map<number, ImportUpload> };

const runs = new Map<string, Run>();
const listeners = new Set<() => void>();
let version = 0;
const snapshots = new Map<string, { version: number; uploads: PhotoUpload[] }>();

function emit() {
  version++;
  listeners.forEach((l) => l());
}

function update(run: Run, index: number, status: UploadStatus) {
  run.uploads = run.uploads.map((u) => (u.index === index ? { ...u, status } : u));
  emit();
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function freshSlots(run: Run): Promise<void> {
  const wire = await apiRequest<ImportCreatedWire>('v1/tenant/outfit-import', { method: 'POST', body: { requestId: run.sessionId, count: run.requested } });
  run.slots = new Map(wire.uploads.map((u) => [u.index, u]));
}

async function confirm(sessionId: string, index: number): Promise<void> {
  await apiRequest<ImportSessionWire>(`v1/tenant/outfit-import/${sessionId}/photos/${index}/uploaded`, { method: 'POST' });
}

async function sendOne(run: Run, upload: PhotoUpload): Promise<void> {
  update(run, upload.index, 'uploading');
  if (DATA_SOURCE.wardrobe !== 'api') {
    fixtureMarkUploaded(run.sessionId, upload.index);
    update(run, upload.index, 'done');
    return;
  }
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (BACKOFF_MS[attempt]) await wait(BACKOFF_MS[attempt]);
    try {
      let slot = run.slots.get(upload.index);
      if (!slot || new Date(slot.expiresAt).getTime() < Date.now() + 15_000) {
        await freshSlots(run);
        slot = run.slots.get(upload.index);
      }
      if (slot) {
        let status = await postToPresigned(upload.localUri, slot);
        if (status === 403) {
          await freshSlots(run);
          const again = run.slots.get(upload.index);
          status = again ? await postToPresigned(upload.localUri, again) : status;
        }
        if (status < 200 || status >= 300) throw new ApiError('http', status, null);
      }
      // No slot = the server already has this photo (a replay lists only the photos not uploaded yet).
      await confirm(run.sessionId, upload.index);
      update(run, upload.index, 'done');
      deleteLocalPhoto(upload.localUri);
      return;
    } catch {
      // next attempt
    }
  }
  update(run, upload.index, 'failed');
}

async function pump(run: Run): Promise<void> {
  const next = () => run.uploads.find((u) => u.status === 'queued');
  const worker = async () => {
    for (let upload = next(); upload; upload = next()) await sendOne(run, upload);
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
}

/** Starts the uploads of a new session: the picked photos in order onto the slots the server issued. */
export function startUploads(sessionId: string, requested: number, slots: ImportUpload[], localUris: string[]): void {
  const uploads = slots.map((slot, i) => ({ index: slot.index, localUri: localUris[i] ?? '', status: 'queued' as UploadStatus })).filter((u) => u.localUri);
  const run: Run = { sessionId, requested, uploads, slots: new Map(slots.map((s) => [s.index, s])) };
  runs.set(sessionId, run);
  emit();
  void pump(run);
}

/** "Tekrar dene" on a photo whose upload failed (31b) or every failed one (31e C). */
export function retryUploads(sessionId: string, index?: number): void {
  const run = runs.get(sessionId);
  if (!run) return;
  run.uploads = run.uploads.map((u) => (u.status === 'failed' && (index === undefined || u.index === index) ? { ...u, status: 'queued' } : u));
  emit();
  void pump(run);
}

/** The uploads of a session on this device (empty after a restart: the server state is what counts then). */
export function useImportUploads(sessionId: string | undefined): PhotoUpload[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => {
      if (!sessionId) return EMPTY;
      const cached = snapshots.get(sessionId);
      if (cached && cached.version === version) return cached.uploads;
      const uploads = runs.get(sessionId)?.uploads ?? EMPTY;
      snapshots.set(sessionId, { version, uploads });
      return uploads;
    },
  );
}

const EMPTY: PhotoUpload[] = [];

/** Tests: forget every run. */
export function resetUploads(): void {
  runs.clear();
  snapshots.clear();
  emit();
}
