import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type { Item, ItemDetail } from '@/api/contracts/wardrobe';
import { fromSource } from '@/api/source';
import { clone, fixtureDb, FixtureNotFound } from '@/fixtures/db';

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
export function useItems() {
  return useQuery({
    queryKey: wardrobeKeys.items,
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
    queryFn: () =>
      fromSource<ItemDetail>(
        'wardrobe',
        () => fixtureItemDetail(id),
        () => apiRequest<ItemDetail>(`v1/tenant/item/${id}`),
      ),
  });
}
