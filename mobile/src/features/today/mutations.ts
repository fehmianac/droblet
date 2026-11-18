import type { QueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type { TodayResponse } from '@/api/contracts';
import type { Look } from '@/api/contracts/looks';
import type {
  AddWatchlistRequest,
  CalendarMonth,
  PlanDay,
  PutLookFavoriteRequest,
  PutPlanDayRequest,
  SaveEditLookRequest,
  WeeklyEdit,
} from '@/api/contracts/today';
import { ApiError, isConflict, isGone } from '@/api/errors';
import { fromSource } from '@/api/dataSource';
import { editLookSlots, fromPriceBand, toPlanDay, type EditWire, type PlanDayWire, type PutPlanDayWire } from '@/api/wire/today';
import { fromOccasion, type LookSlotInputWire, type LookWire } from '@/api/wire/wardrobe';
import { lookKeys } from '@/features/looks/queries';
import { fixtureAddToWatchlist, fixturePutPlanDay, fixtureSaveEditLook, fixtureSetLookFavorite } from '@/fixtures/today';
import { ulid } from '@/lib/ids';
import { conflictStore } from '@/sync/conflicts';
import { queryKeys, TENANT_WRITE_SCOPE } from '@/sync/queryKeys';

import { planKeys, todayMutationKeys } from './keys';

type Meta = { occurredAt: string };
export type PutPlanDayVariables = PutPlanDayRequest & Meta & { date: string };
export type SetLookFavoriteVariables = PutLookFavoriteRequest & Meta & { lookId: string };
export type AddWatchlistVariables = AddWatchlistRequest & Meta;
export type SaveEditLookVariables = SaveEditLookRequest & Meta;

function applyPlanDay(list: PlanDay[], vars: PutPlanDayVariables): PlanDay[] {
  const rest = list.filter((p) => p.date !== vars.date);
  if (vars.occasion === null && vars.lookId === null) return rest;
  return [...rest, { date: vars.date, occasion: vars.occasion, lookId: vars.lookId, baseVersion: vars.baseVersion }];
}

/** Applies a plan-day write to every cached plan query: week ranges (arrays) and calendar months (objects). */
export function patchPlanCaches(client: QueryClient, vars: PutPlanDayVariables): void {
  client.setQueriesData<PlanDay[] | CalendarMonth>({ queryKey: planKeys.planDays }, (prev) => {
    if (!prev) return prev;
    if (Array.isArray(prev)) return applyPlanDay(prev, vars);
    return vars.date.startsWith(prev.month) ? { ...prev, planDays: applyPlanDay(prev.planDays, vars) } : prev;
  });
}

/** PUT body of a look with only `favorite` changed (every user field is replaced, so all are sent back). */
function favoriteBody(look: LookWire, favorite: boolean) {
  const slots: LookSlotInputWire[] = look.slots.map((s) =>
    s.itemId ? { slot: s.slot, itemId: s.itemId } : { slot: s.slot, productId: s.productId ?? undefined },
  );
  return { name: look.name, occasion: look.occasion, slots, favorite, baseVersion: look.version };
}

/**
 * Heart: there is no narrow favourite endpoint, so the look is read and written back with the
 * versioned `PUT v1/tenant/look/{id}`. A 409 carries the current look — the heart is re-applied to it
 * once (the user only toggled the heart; nothing else of theirs can be lost).
 */
export async function putLookFavorite(lookId: string, favorite: boolean): Promise<void> {
  const path = `v1/tenant/look/${lookId}`;
  const look = await apiRequest<LookWire>(path);
  if (look.favorite === favorite) return;
  try {
    await apiRequest<LookWire>(path, { method: 'PUT', body: favoriteBody(look, favorite) });
  } catch (e) {
    if (!isConflict(e) || !e.current) throw e;
    await apiRequest<LookWire>(path, { method: 'PUT', body: favoriteBody(e.current as LookWire, favorite) });
  }
}

/** The wire edit that contains `editLookId`: the named edit, else the current one. */
async function findEditLook(editLookId: string, editId: string | undefined) {
  const ids = editId && editId !== 'current' ? [editId, 'current'] : ['current'];
  for (const id of ids) {
    try {
      const edit = await apiRequest<EditWire>(`v1/content/edit/${encodeURIComponent(id)}`);
      const look = edit.looks.find((l) => l.id === editLookId);
      if (look) return look;
    } catch (e) {
      if (!isGone(e)) throw e;
    }
  }
  return null;
}

/**
 * Queued writes of the Bugün slice. Paused mutations are persisted without their function, so every
 * write registers its `mutationFn` here by key to resume after an app restart.
 */
export function registerTodayMutations(client: QueryClient): void {
  const refreshPlans = () => {
    void client.invalidateQueries({ queryKey: planKeys.planDays });
    void client.invalidateQueries({ queryKey: queryKeys.today });
  };

  // 07 / 09 — PUT v1/tenant/plan-day/{date} { occasion, lookId, baseVersion } (versioned; 409 = the current record,
  // 422 `look_not_found`). Clearing the day is DELETE v1/tenant/plan-day/{date} (204; 404 = already clear).
  client.setMutationDefaults(todayMutationKeys.putPlanDay, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: PutPlanDayVariables) => {
      const body: PutPlanDayRequest = { occasion: vars.occasion, lookId: vars.lookId, baseVersion: vars.baseVersion, clientMutationId: vars.clientMutationId };
      return fromSource<PlanDay | null>(
        'today',
        () => fixturePutPlanDay(vars.date, body.occasion, body.lookId),
        async () => {
          const path = `v1/tenant/plan-day/${vars.date}`;
          if (body.occasion === null && body.lookId === null) {
            try {
              await apiRequest<void>(path, { method: 'DELETE' });
            } catch (e) {
              if (!isGone(e)) throw e;
            }
            return null;
          }
          const wire: PutPlanDayWire = { occasion: fromOccasion(body.occasion), lookId: body.lookId, baseVersion: body.baseVersion };
          return toPlanDay(await apiRequest<PlanDayWire>(path, { method: 'PUT', body: wire }));
        },
      );
    },
    onMutate: async (vars: PutPlanDayVariables) => {
      await client.cancelQueries({ queryKey: planKeys.planDays });
      patchPlanCaches(client, vars);
    },
    onSuccess: refreshPlans,
    onError: (error: unknown, vars: PutPlanDayVariables) => {
      if (isConflict(error)) {
        const current = error.current ? toPlanDay(error.current as PlanDayWire) : undefined;
        conflictStore.push({
          id: vars.clientMutationId,
          kind: 'changed',
          keepTheirs: refreshPlans,
          keepMine: current
            ? () =>
                void client
                  .getMutationCache()
                  .build(client, { mutationKey: todayMutationKeys.putPlanDay, scope: TENANT_WRITE_SCOPE })
                  .execute({ ...vars, baseVersion: current.baseVersion, clientMutationId: ulid() })
            : undefined,
        });
      }
      refreshPlans();
    },
  });

  // 06 heart — GET + versioned PUT v1/tenant/look/{id} with only `favorite` changed (see `putLookFavorite`).
  client.setMutationDefaults(todayMutationKeys.setLookFavorite, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: SetLookFavoriteVariables) => {
      const body: PutLookFavoriteRequest = { isFavorite: vars.isFavorite, clientMutationId: vars.clientMutationId };
      return fromSource<void>(
        'today',
        () => fixtureSetLookFavorite(vars.lookId, body.isFavorite),
        () => putLookFavorite(vars.lookId, body.isFavorite),
      );
    },
    onMutate: (vars: SetLookFavoriteVariables) => {
      client.setQueryData<TodayResponse>(queryKeys.today, (prev) =>
        prev?.look && prev.look.id === vars.lookId ? { ...prev, look: { ...prev.look, isFavorite: vars.isFavorite } } : prev,
      );
      client.setQueryData<Look[]>(lookKeys.looks, (prev) =>
        prev?.map((l) => (l.id === vars.lookId ? { ...l, isFavorite: vars.isFavorite } : l)),
      );
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: queryKeys.today });
      void client.invalidateQueries({ queryKey: lookKeys.looks });
    },
  });

  // 08 "İzleme listeme ekle" — PUT v1/tenant/watch-list/{productId} { look: { kind: "edit", id } } (replay-safe;
  // 404 `product_not_found`, 422 `product_retired` / `watch_list_full`). Screen 24b is the store slice's.
  const watchlistKey = ['tenant', 'watchlist'] as const;
  client.setMutationDefaults(todayMutationKeys.addToWatchlist, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: AddWatchlistVariables) => {
      const body: AddWatchlistRequest = { productId: vars.productId, editLookId: vars.editLookId, clientMutationId: vars.clientMutationId };
      return fromSource<void>(
        'today',
        () => fixtureAddToWatchlist(body.productId),
        async () => {
          await apiRequest<unknown>(`v1/tenant/watch-list/${encodeURIComponent(body.productId)}`, {
            method: 'PUT',
            body: body.editLookId ? { look: { kind: 'edit', id: body.editLookId } } : {},
          });
        },
      );
    },
    onMutate: (vars: AddWatchlistVariables) => {
      client.setQueriesData<WeeklyEdit>({ queryKey: planKeys.edits }, (prev) =>
        prev
          ? {
              ...prev,
              looks: prev.looks.map((look) => ({
                ...look,
                products: {
                  high_street: look.products.high_street.map((p) => (p.id === vars.productId ? { ...p, inWatchlist: true } : p)),
                  luxury_touch: look.products.luxury_touch.map((p) => (p.id === vars.productId ? { ...p, inWatchlist: true } : p)),
                },
              })),
            }
          : prev,
      );
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: watchlistKey }),
    onError: () => void client.invalidateQueries({ queryKey: planKeys.edits }),
  });

  // 08 heart — POST v1/tenant/look { id, name, occasion, slots, favorite, source: "edit" } with one catalogue product
  // per slot of the chosen price band (201; 200 when the same id is sent again; 422 `look_min_pieces`, …).
  client.setMutationDefaults(todayMutationKeys.saveEditLook, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: SaveEditLookVariables) => {
      const body: SaveEditLookRequest = { id: vars.id, editLookId: vars.editLookId, band: vars.band, editId: vars.editId, clientMutationId: vars.clientMutationId };
      return fromSource<void>(
        'today',
        () => fixtureSaveEditLook(body),
        async () => {
          const look = await findEditLook(body.editLookId, body.editId);
          // The edit was retired while the write was queued: nothing to save any more.
          if (!look) throw new ApiError('http', 404, { code: 'not_found' });
          await apiRequest<LookWire>('v1/tenant/look', {
            method: 'POST',
            body: {
              id: body.id,
              name: look.title.slice(0, 60),
              occasion: null,
              slots: editLookSlots(look, fromPriceBand(body.band)),
              favorite: false,
              source: 'edit',
            },
          });
        },
      );
    },
    onMutate: (vars: SaveEditLookVariables) => {
      client.setQueriesData<WeeklyEdit>({ queryKey: planKeys.edits }, (prev) =>
        prev ? { ...prev, looks: prev.looks.map((l) => (l.id === vars.editLookId ? { ...l, isSaved: true } : l)) } : prev,
      );
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: lookKeys.looks }),
    onError: () => void client.invalidateQueries({ queryKey: planKeys.edits }),
  });
}
