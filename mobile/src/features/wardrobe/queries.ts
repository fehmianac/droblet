import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type { Item, ItemDetail, ItemDraft, ItemPreview } from '@/api/contracts/wardrobe';
import { jobPollInterval } from '@/api/jobs';
import { fromSource } from '@/api/dataSource';
import {
  requestItems,
  toItemDetail,
  toItemDrafts,
  type ItemDetailWire,
  type ItemDraftsWire,
} from '@/api/wire/wardrobe';
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
        // GET v1/tenant/item → ItemDto[], newest first.
        () => requestItems(),
      ),
  });
}

const fetchItemDetail = (id: string) =>
  fromSource<ItemDetail>(
    'wardrobe',
    () => fixtureItemDetail(id),
    // GET v1/tenant/item/{id} → { item, looks } · 404
    async () => toItemDetail(await apiRequest<ItemDetailWire>(`v1/tenant/item/${id}`)),
  );

/** 11 Parça detayı — the piece + wear count + looks using it. */
export function useItemDetail(id: string) {
  return useQuery({
    queryKey: wardrobeKeys.item(id),
    enabled: Boolean(id),
    queryFn: () => fetchItemDetail(id),
  });
}

/** Only what the 11′ skeleton draws at once (photo, category, name): the facts and looks wait for the detail. */
export function toItemPreview(item: Item): ItemPreview {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    subcategory: item.subcategory,
    color: item.color,
    brand: item.brand,
    imageUrl: item.imageUrl,
    thumbUrl: item.thumbUrl,
    mediumUrl: item.mediumUrl,
    imageCacheKey: item.imageCacheKey,
    imageUrlExpiresAt: item.imageUrlExpiresAt,
    originalImageUrl: item.originalImageUrl,
    useOriginalImage: item.useOriginalImage,
  };
}

/** True once the whole detail is there (not only the list's preview). */
export const isItemDetail = (data: ItemDetail | ItemPreview): data is ItemDetail => 'looks' in data;

/**
 * 11 Parça detayı opened from the grid (canvas 11′): until the detail arrives the query holds the piece as the
 * wardrobe list knows it (placeholder, never cached), so the screen draws at once instead of a loader.
 */
export function useItemDetailWithPreview(id: string) {
  const client = useQueryClient();
  return useQuery<ItemDetail | ItemPreview>({
    queryKey: wardrobeKeys.item(id),
    enabled: Boolean(id),
    queryFn: () => fetchItemDetail(id),
    placeholderData: () => {
      const listed = client.getQueryData<Item[]>(wardrobeKeys.items)?.find((i) => i.id === id);
      return listed ? toItemPreview(listed) : undefined;
    },
  });
}

/**
 * 12c / 13 — pending AI drafts (they live on the server, so a reopened screen shows them again).
 * Polls while any draft is still processing (750 ms, then every 1.5 s); a screen that is not focused passes
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
        // GET v1/tenant/item-draft → { drafts, total, processed }
        async () => toItemDrafts(await apiRequest<ItemDraftsWire>('v1/tenant/item-draft')),
      ),
    refetchInterval: (q) =>
      q.state.data?.some((d) => d.status === 'processing') ? jobPollInterval(q.state.dataUpdateCount > 1 ? 3000 : 0) : false,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}
