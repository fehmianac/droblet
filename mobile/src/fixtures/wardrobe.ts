import type {
  ConfirmItemDraftsRequest,
  ConfirmItemDraftsResponse,
  CreateItemDraftsRequest,
  CreateItemDraftsResponse,
  DraftField,
  Item,
  ItemDraft,
  ItemFields,
  PutItemRequest,
} from '@/api/contracts/wardrobe';
import { ApiError } from '@/api/errors';

import { clone, fixtureDb } from './db';
import { L } from './showcase';

/**
 * Fixture side of E2 Gardırop: item writes edit `fixtureDb.items` like the server would, and item
 * drafts (the ItemProcessor's output) live here in memory. A draft turns `ready` after a few seconds
 * of wall-clock time with a plausible suggestion. Nothing survives an app restart.
 */

type StoredDraft = {
  id: string;
  requestId: string;
  localUri: string | null;
  createdAt: number;
  readyAfterMs: number;
  fails: boolean;
  suggestion: Partial<ItemFields>;
  lowConfidence: DraftField[];
};

let drafts: StoredDraft[] = [];
let sequence = 0;

/** Dev/test knobs. `failEvery: 4` makes every 4th draft fail; `baseMs` / `stepMs` control processing time. */
export const fixtureDraftOptions = { baseMs: 2500, stepMs: 900, failEvery: 0, lowConfidenceEvery: 3 };

const SUGGESTIONS: Partial<ItemFields>[] = [
  { name: L('Beyaz poplin gömlek'), category: 'top', subcategory: L('Gömlek'), color: 'white', fabric: L('Pamuk'), seasons: ['spring', 'autumn'] },
  { name: L('Düz jean'), category: 'bottom', subcategory: L('Jean'), color: 'blue', fabric: L('Denim'), seasons: ['spring', 'summer', 'autumn', 'winter'] },
  { name: L('Kroko babet'), category: 'shoes', subcategory: L('Babet'), color: 'black', fabric: L('Deri'), seasons: ['spring', 'summer', 'autumn'] },
  { name: L('Siyah deri çanta'), category: 'bag', subcategory: L('Omuz çantası'), color: 'black', fabric: L('Deri'), seasons: ['spring', 'summer', 'autumn', 'winter'] },
  { name: L('Krem triko'), category: 'top', subcategory: L('Triko'), color: 'cream', fabric: L('Yün'), seasons: ['autumn', 'winter'] },
  { name: L('Bej trençkot'), category: 'outerwear', subcategory: L('Trençkot'), color: 'beige', fabric: L('Pamuk'), seasons: ['spring', 'autumn'] },
];

function toDraft(stored: StoredDraft): ItemDraft {
  const elapsed = Date.now() - stored.createdAt;
  const done = elapsed >= stored.readyAfterMs;
  const status: ItemDraft['status'] = !done ? 'processing' : stored.fails ? 'failed' : 'ready';
  return {
    id: stored.id,
    status,
    requestId: stored.requestId,
    imageUrl: stored.localUri,
    originalImageUrl: stored.localUri,
    suggestion: status === 'ready' ? clone(stored.suggestion) : null,
    lowConfidence: status === 'ready' ? [...stored.lowConfidence] : [],
  };
}

function addDraft(requestId: string, localUri: string | null, position: number): StoredDraft {
  sequence += 1;
  const { baseMs, stepMs, failEvery, lowConfidenceEvery } = fixtureDraftOptions;
  const stored: StoredDraft = {
    id: `draft_${requestId}_${sequence}`,
    requestId,
    localUri,
    createdAt: Date.now(),
    readyAfterMs: baseMs + position * stepMs,
    fails: failEvery > 0 && sequence % failEvery === 0,
    suggestion: SUGGESTIONS[(sequence - 1) % SUGGESTIONS.length] ?? {},
    lowConfidence: lowConfidenceEvery > 0 && sequence % lowConfidenceEvery === 0 ? ['category'] : [],
  };
  drafts.push(stored);
  return stored;
}

/** POST v1/tenant/item-draft. `photoKeys` are local URIs in fixture mode (nothing is uploaded). Idempotent on `requestId`. */
export function fixtureCreateDrafts(request: CreateItemDraftsRequest): CreateItemDraftsResponse {
  const existing = drafts.filter((d) => d.requestId === request.requestId);
  if (existing.length > 0) return { jobId: `job_${request.requestId}`, draftIds: existing.map((d) => d.id) };
  // Free recognition quota: nothing left → 402; part of the batch fits → those start, the rest is skipped.
  const quota = fixtureDb.entitlement.itemRecognition;
  let photoKeys = request.photoKeys;
  if (quota && quota.limit !== null) {
    const remaining = Math.max(0, quota.remaining ?? quota.limit - quota.used);
    if (remaining === 0) throw new ApiError('http', 402, { status: 402, code: 'item_recognition_limit_reached' });
    photoKeys = photoKeys.slice(0, remaining);
    quota.used += photoKeys.length;
    quota.remaining = remaining - photoKeys.length;
  }
  const skippedCount = request.photoKeys.length - photoKeys.length;
  const created: StoredDraft[] = [];
  photoKeys.forEach((key) => {
    // "Kombin fotoğrafından ayır": one outfit photo yields several pieces.
    const pieces = request.splitOutfit ? 3 : 1;
    for (let i = 0; i < pieces; i++) created.push(addDraft(request.requestId, key, created.length));
  });
  return { jobId: `job_${request.requestId}`, draftIds: created.map((d) => d.id), ...(skippedCount > 0 ? { skippedCount } : {}) };
}

/**
 * Entitlement fixture for the recognition quota: a non-member with `limit` free recognitions of which
 * `used` are spent (`limit: null` → member, unlimited). Reset by `resetFixtureDb`.
 */
export function setFixtureItemRecognition(limit: number | null, used = 0): void {
  fixtureDb.entitlement.tier = limit === null ? 'member' : 'free';
  fixtureDb.entitlement.itemRecognition = { limit, used, remaining: limit === null ? null : Math.max(0, limit - used) };
}

/** GET v1/tenant/item-draft */
export function fixtureListDrafts(): ItemDraft[] {
  return drafts.map(toDraft);
}

/**
 * POST v1/tenant/item-draft/{id}/select — fixture drafts never form a group (one suggestion per photo), so
 * there is nothing to keep or discard; the pieces named stay as they are.
 */
export function fixtureSelectDetected(groupId: string, draftIds: string[]): void {
  if (!drafts.some((d) => d.id === groupId) && draftIds.length > 0) throw new ApiError('http', 404, { status: 404, code: 'draft_not_found' });
}

/** DELETE v1/tenant/item-draft/{id} */
export function fixtureDeleteDraft(id: string): void {
  drafts = drafts.filter((d) => d.id !== id);
}

/** POST v1/tenant/item-draft/{id}/retry */
export function fixtureRetryDraft(id: string): void {
  const stored = drafts.find((d) => d.id === id);
  if (!stored) throw new ApiError('http', 404, null);
  stored.createdAt = Date.now();
  stored.readyAfterMs = fixtureDraftOptions.baseMs;
  stored.fails = false;
}

/** POST v1/tenant/item-draft/confirm — idempotent on the item id. */
export function fixtureConfirmDrafts(request: ConfirmItemDraftsRequest): ConfirmItemDraftsResponse {
  const items = request.items.map((entry): Item => {
    const known = fixtureDb.items.find((i) => i.id === entry.id);
    if (known) return clone(known);
    const draft = entry.draftId ? drafts.find((d) => d.id === entry.draftId) : undefined;
    const item: Item = {
      id: entry.id,
      name: entry.name,
      category: entry.category,
      subcategory: entry.subcategory,
      brand: entry.brand,
      size: entry.size,
      color: entry.color,
      fabric: entry.fabric,
      seasons: entry.seasons,
      // A manual entry may carry its own photo (`photoKey` is the local URI in fixture mode).
      imageUrl: draft?.localUri ?? entry.photoKey ?? null,
      originalImageUrl: draft?.localUri ?? entry.photoKey ?? null,
      useOriginalImage: entry.useOriginalImage,
      wearCount: 0,
      lastWornAt: null,
      createdAt: new Date().toISOString(),
      baseVersion: 1,
    };
    fixtureDb.items.unshift(item);
    if (entry.draftId) fixtureDeleteDraft(entry.draftId);
    return clone(item);
  });
  return { items };
}

/** PUT v1/tenant/item/{id} */
export function fixturePutItem(id: string, request: PutItemRequest): Item {
  const item = fixtureDb.items.find((i) => i.id === id);
  if (!item) throw new ApiError('http', 404, null);
  if (request.baseVersion < item.baseVersion) throw new ApiError('http', 409, { code: 'version_conflict', current: clone(item) });
  const { baseVersion: _base, clientMutationId: _id, ...fields } = request;
  void _base;
  void _id;
  Object.assign(item, fields, { baseVersion: item.baseVersion + 1 });
  // Looks show the piece's current name.
  fixtureDb.looks.forEach((look) =>
    look.slots.forEach((slot) => {
      if (slot.source === 'wardrobe' && slot.refId === id) slot.name = item.name;
    }),
  );
  return clone(item);
}

/** DELETE v1/tenant/item/{id} — look slots keep the reference, marked as a deleted piece. */
export function fixtureDeleteItem(id: string): void {
  fixtureDb.items = fixtureDb.items.filter((i) => i.id !== id);
  fixtureDb.looks.forEach((look) =>
    look.slots.forEach((slot) => {
      if (slot.source === 'wardrobe' && slot.refId === id) slot.deleted = true;
    }),
  );
}

export function resetFixtureDrafts(): void {
  drafts = [];
  sequence = 0;
  Object.assign(fixtureDraftOptions, { baseMs: 2500, stepMs: 900, failEvery: 0, lowConfidenceEvery: 3 });
}
