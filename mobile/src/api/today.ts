import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ulid } from '@/lib/ids';

import { planKeys } from '@/features/today/keys';
import { sessionStore } from '@/auth/session';
import { buildTodayFixture, fixtureLogWear, libraryFixture, menLibraryFixture, withLatency } from '@/fixtures/today';
import { useSegment } from '@/features/segment/store';
import { toIsoDate } from '@/lib/format';
import { newClientMutation } from '@/sync/clientMutation';
import { mutationKeys, queryKeys } from '@/sync/queryKeys';

import { apiRequest } from './client';
import type { LibraryItem, TodayResponse, WearLogRequest } from './contracts';
import { DATA_SOURCE, fromSource, queryString } from './dataSource';
import type { ProfileWire } from './wire/core';
import { firstNameOf, toToday, toWeeklyEditCards, type EditWire, type TodayWire } from './wire/today';
import { ITEMS_QUERY_KEY, loadLookContext, toItemColor, type ItemWire } from './wire/wardrobe';

/** A side read of the Bugün card: its failure never fails the card. */
async function optional<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch {
    return null;
  }
}

/**
 * `GET v1/tenant/today?date=` (the device's local day; no coordinates → the forecast of the profile
 * city, null when there is none) joined with what the card also shows: piece names / images (wardrobe
 * cache + catalogue), the first name, the city name (`GET v1/tenant/settings`), an existing try-on
 * image of the look (`GET v1/tenant/tryon?kind=look&id=`, 404 = none) and the weekly edit strip
 * (`GET v1/content/edit/current`, 404 = none published).
 */
export async function requestToday(date: string): Promise<TodayResponse> {
  const wire = await apiRequest<TodayWire>(`v1/tenant/today?date=${date}`);
  const sessionName = sessionStore.getTokens()?.user.name ?? '';
  const [ctx, edit, settings, tryOn, profile] = await Promise.all([
    loadLookContext([wire.look]),
    optional(apiRequest<EditWire>('v1/content/edit/current')),
    wire.weather ? optional(apiRequest<{ city: { name: string } | null }>('v1/tenant/settings')) : null,
    wire.look ? optional(apiRequest<{ url: string }>(`v1/tenant/tryon?kind=look&id=${wire.look.id}`)) : null,
    sessionName ? null : optional(apiRequest<ProfileWire>('v1/tenant/profile')),
  ]);
  return toToday(wire, {
    ctx,
    firstName: firstNameOf(sessionName || profile?.displayName),
    cityName: settings?.city?.name ?? '',
    tryOnImageUrl: tryOn?.url ?? null,
    weeklyEdit: edit ? toWeeklyEditCards(edit) : [],
  });
}

/** 06 Bugün. */
export function useToday() {
  return useQuery({
    queryKey: queryKeys.today,
    queryFn: () =>
      fromSource<TodayResponse>(
        'today',
        () => buildTodayFixture(),
        () => requestToday(toIsoDate(new Date())),
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
      // The queued write (`POST v1/tenant/wear-log`) is registered in src/sync; in fixture mode keep the fixture calendar in step.
      if (DATA_SOURCE.today === 'fixtures') fixtureLogWear(vars.lookId, vars.date, vars.occurredAt);
      m.mutate(vars, {
        onSuccess: () => {
          void client.invalidateQueries({ queryKey: planKeys.planDays });
          // Wear counts of the look's pieces went up (once per calendar day).
          void client.invalidateQueries({ queryKey: ITEMS_QUERY_KEY });
        },
      });
    },
  };
}

/** Wire row of `GET v1/tenant/library/item`. */
export type LibraryItemWire = {
  id: string;
  name: string;
  category: string;
  subcategory?: string | null;
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
    subcategory: wire.subcategory ?? null,
    imageUrl: wire.imageUrl ?? null,
    color: wire.colorIds && wire.colorIds.length > 0 ? toItemColor(wire.colorIds[0]) : null,
  };
}

/** Ready-made piece library (04b / 12b) — `GET v1/tenant/library/item?segment=` (the user's segment, canvas 17). */
export function useItemLibrary() {
  const segment = useSegment();
  return useQuery({
    queryKey: queryKeys.libraryFor(segment),
    queryFn: () =>
      fromSource<LibraryItem[]>(
        'library',
        () => withLatency(segment === 'men' ? menLibraryFixture : libraryFixture),
        async () =>
          (await apiRequest<LibraryItemWire[]>(`v1/tenant/library/item${queryString({ segment })}`)).map(toLibraryItem),
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
