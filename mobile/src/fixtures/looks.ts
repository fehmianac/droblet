import type { CreateLookRequest, Look, LookSlot, LookSlotInput, PutLookRequest } from '@/api/contracts/looks';
import { ApiError } from '@/api/errors';

import { accountFixtures } from './account';
import { clone, fixtureDb } from './db';
import { localizedCatalogue } from './store';

/**
 * Fixture "server" for look writes (E3). Store slots (`source: 'store'`, a missing piece) are resolved
 * from the catalogue fixture of the store slice, like the server resolves them from the catalogue.
 */
function resolveSlot(input: LookSlotInput): LookSlot {
  if (input.source === 'wardrobe') {
    const item = fixtureDb.items.find((i) => i.id === input.refId);
    return {
      ...input,
      name: item?.name ?? '',
      imageUrl: item ? (item.useOriginalImage ? item.originalImageUrl : item.imageUrl) : null,
      brand: item?.brand ?? null,
      price: null,
      deleted: !item,
    };
  }
  const product = localizedCatalogue().find((p) => p.id === input.refId);
  return { ...input, name: product?.name ?? '', imageUrl: product?.imageUrl ?? null, brand: product?.brandName ?? null, price: product?.price ?? null, deleted: false };
}

export function fixtureCreateLook(request: CreateLookRequest): Look {
  const existing = fixtureDb.looks.find((l) => l.id === request.id);
  if (existing) return clone(existing);
  const look: Look = {
    id: request.id,
    name: request.name,
    occasion: request.occasion,
    slots: request.slots.map(resolveSlot),
    isFavorite: false,
    rating: null,
    ratingCount: 0,
    tryOnImageUrl: null,
    createdAt: new Date().toISOString(),
    baseVersion: 1,
  };
  fixtureDb.looks = [look, ...fixtureDb.looks];
  return clone(look);
}

export function fixturePutLook(id: string, request: PutLookRequest): Look {
  const index = fixtureDb.looks.findIndex((l) => l.id === id);
  const current = fixtureDb.looks[index];
  if (!current) throw new ApiError('http', 404, null);
  if (current.baseVersion !== request.baseVersion) throw new ApiError('http', 409, { current: clone(current) });
  const slotsChanged = JSON.stringify(current.slots.map((s) => [s.slot, s.source, s.refId])) !== JSON.stringify(request.slots.map((s) => [s.slot, s.source, s.refId]));
  const saved: Look = {
    ...current,
    name: request.name,
    occasion: request.occasion,
    slots: request.slots.map(resolveSlot),
    isFavorite: request.isFavorite,
    // A try-on image belongs to the pieces it was generated for.
    tryOnImageUrl: slotsChanged ? null : current.tryOnImageUrl,
    baseVersion: current.baseVersion + 1,
  };
  fixtureDb.looks[index] = saved;
  return clone(saved);
}

export function fixtureDeleteLook(id: string): void {
  fixtureDb.looks = fixtureDb.looks.filter((l) => l.id !== id);
}

/** Test switch: the next "Akışta paylaş" write fails with this server code (final answer, no retry). */
export const feedShareFixtureOptions: { failNext: { status: number; code: string } | null } = { failNext: null };

/**
 * PUT / DELETE v1/tenant/look/{id}/feed-share (Akış F2) with the server's rules: a verified e-mail and an @handle
 * are needed, and an imported look cannot be shared. Turning it off always works.
 */
export function fixtureSetFeedShare(id: string, shared: boolean): void {
  const failure = feedShareFixtureOptions.failNext;
  if (failure) {
    feedShareFixtureOptions.failNext = null;
    throw new ApiError('http', failure.status, { status: failure.status, code: failure.code });
  }
  const look = fixtureDb.looks.find((l) => l.id === id);
  if (!look) throw new ApiError('http', 404, null);
  if (shared) {
    const profile = accountFixtures.profile();
    if (profile.emailVerified === false) throw new ApiError('http', 422, { status: 422, code: 'email_not_verified' });
    if (!profile.handle) throw new ApiError('http', 422, { status: 422, code: 'handle_required' });
    if (look.imported) throw new ApiError('http', 422, { status: 422, code: 'look_not_shareable' });
  }
  look.sharedToFeed = shared;
  look.feedStats = shared ? (look.feedStats ?? { likeCount: 0, saveCount: 0 }) : null;
}
