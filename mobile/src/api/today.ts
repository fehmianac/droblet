import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ulid } from '@/lib/ids';

import { planKeys } from '@/features/today/keys';
import { buildTodayFixture, fixtureLogWear, libraryFixture, withLatency } from '@/fixtures/today';
import { toIsoDate } from '@/lib/format';
import { newClientMutation } from '@/sync/clientMutation';
import { mutationKeys, queryKeys } from '@/sync/queryKeys';

import { apiRequest } from './client';
import type { LibraryItem, TodayResponse, WearLogRequest } from './contracts';
import { DATA_SOURCE, fromSource } from './dataSource';
import { ITEMS_QUERY_KEY, toItemColor, type ItemWire } from './wire/wardrobe';

/** 06 Bugün — `GET v1/tenant/today?date=` (fixture-backed behind the `today` source switch). */
export function useToday() {
  return useQuery({
    queryKey: queryKeys.today,
    queryFn: () =>
      fromSource<TodayResponse>(
        'today',
        () => buildTodayFixture(),
        () => apiRequest<TodayResponse>(`v1/tenant/today?date=${toIsoDate(new Date())}`),
      ),
  });
}

/** "Bunu giyiyorum" — an event write through the queue; optimistic. */
export function useWearToday() {
  const client = useQueryClient();
  const m = useMutation<WearLogRequest, unknown, WearLogRequest>({
    mutationKey: mutationKeys.createWearLog,
    onMutate: (vars) => {
      client.setQueryData<TodayResponse>(queryKeys.today, (prev) =>
        prev?.look && prev.look.id === vars.lookId ? { ...prev, look: { ...prev.look, wornToday: true } } : prev,
      );
    },
  });
  return {
    ...m,
    wear: (lookId: string) => {
      const vars: WearLogRequest = { lookId, date: toIsoDate(new Date()), ...newClientMutation() };
      // The queued write is registered in src/sync (fixture no-op there); keep the fixture calendar in step.
      if (DATA_SOURCE.today === 'fixtures') fixtureLogWear(vars.lookId, vars.date, vars.occurredAt);
      m.mutate(vars, { onSuccess: () => void client.invalidateQueries({ queryKey: planKeys.planDays }) });
    },
  };
}

/** Wire row of `GET v1/tenant/library/item`. */
export type LibraryItemWire = {
  id: string;
  name: string;
  category: string;
  colorIds: string[];
  fabric: string | null;
  seasons: string[];
  imageUrl: string | null;
};

/** Library row → app shape: the picture URL is kept as sent (null = no picture yet) and the main colour tints its placeholder. */
export function toLibraryItem(wire: LibraryItemWire): LibraryItem {
  return {
    id: wire.id,
    name: wire.name,
    category: wire.category,
    imageUrl: wire.imageUrl ?? null,
    color: wire.colorIds && wire.colorIds.length > 0 ? toItemColor(wire.colorIds[0]) : null,
  };
}

/** Ready-made piece library (04b / 12b) — `GET v1/tenant/library/item`. */
export function useItemLibrary() {
  return useQuery({
    queryKey: queryKeys.library,
    queryFn: () =>
      fromSource<LibraryItem[]>(
        'library',
        () => withLatency(libraryFixture),
        async () =>
          (await apiRequest<LibraryItemWire[]>('v1/tenant/library/item')).map(toLibraryItem),
      ),
  });
}

/** One row per requested piece: `created` | `alreadyApplied` | `rejected` (+ `code`). */
type ItemCreateResultsWire = {
  results: { refId: string; outcome: 'created' | 'alreadyApplied' | 'rejected'; code: string | null; item: ItemWire | null }[];
  createdCount: number;
};

/**
 * 04b "İlk 5 parça" — `POST v1/tenant/item/from-library` (1–30 pieces, one `clientMutationId` each;
 * the new item id is that id). Online, interactive: the caller moves on whatever the outcome, the
 * pieces can always be added later from 12b.
 */
export function useAddLibraryItems() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (libraryItemIds: string[]) =>
      fromSource<number>(
        'library',
        () => libraryItemIds.length,
        async () => {
          if (libraryItemIds.length === 0) return 0;
          const body = { items: libraryItemIds.slice(0, 30).map((libraryItemId) => ({ clientMutationId: ulid(), libraryItemId })) };
          const res = await apiRequest<ItemCreateResultsWire>('v1/tenant/item/from-library', { method: 'POST', body });
          return res.createdCount;
        },
      ),
    onSuccess: () => void client.invalidateQueries({ queryKey: ITEMS_QUERY_KEY }),
  });
}
