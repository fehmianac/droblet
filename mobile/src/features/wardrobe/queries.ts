import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type { Item, ItemDetail, ItemDraft } from '@/api/contracts/wardrobe';
import { jobPollInterval } from '@/api/jobs';
import { fromSource } from '@/api/dataSource';
import { clone, fixtureDb, FixtureNotFound } from '@/fixtures/db';
import { fixtureListDrafts } from '@/fixtures/wardrobe';

/** Query keys of the wardrobe feature (E2). */
export const wardrobeKeys = {
  items: ['tenant', 'item'] as const,
  item: (id: string) => ['tenant', 'item', id] as const,
  drafts: ['tenant', 'item-draft'] as const,
};

function fixtureItemDetail(id: string): ItemDetail {
  const item = fixtureDb.items.find((i) => i.id === id);
  if (!item) throw new FixtureNotFound(`item ${id}`);
  const looks = fixtureDb.looks
    .filter((l) => l.slots.some((s) => s.source === 'wardrobe' && s.refId === id))
    .map((l) => ({ id: l.id, name: l.name, occasion: l.occasion, imageUrl: l.tryOnImageUrl }));
  return clone({ ...item, looks });
}

/** 10 Parçalar — the whole wardrobe; filtering, sorting and search run on the device (works offline from cache). */
export function useItems(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: wardrobeKeys.items,
    enabled: options.enabled ?? true,
    queryFn: () =>
      fromSource<Item[]>(
        'wardrobe',
        () => clone(fixtureDb.items),
        () => apiRequest<Item[]>('v1/tenant/item'),
      ),
  });
}

/** 11 Parça detayı — the piece + wear count + looks using it. */
export function useItemDetail(id: string) {
  return useQuery({
    queryKey: wardrobeKeys.item(id),
    enabled: Boolean(id),
    queryFn: () =>
      fromSource<ItemDetail>(
        'wardrobe',
        () => fixtureItemDetail(id),
        () => apiRequest<ItemDetail>(`v1/tenant/item/${id}`),
      ),
  });
}

/**
 * 12c / 13 — pending AI drafts (they live on the server, so a reopened screen shows them again).
 * Polls with back-off while any draft is still processing; a screen that is not focused passes
 * `enabled: false`.
 */
export function useItemDrafts(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: wardrobeKeys.drafts,
    enabled: options.enabled ?? true,
    queryFn: () =>
      fromSource<ItemDraft[]>(
        'wardrobe',
        () => fixtureListDrafts(),
        () => apiRequest<ItemDraft[]>('v1/tenant/item-draft'),
      ),
    refetchInterval: (q) =>
      q.state.data?.some((d) => d.status === 'processing') ? jobPollInterval(Math.min(q.state.dataUpdateCount - 1, 1)) : false,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}
