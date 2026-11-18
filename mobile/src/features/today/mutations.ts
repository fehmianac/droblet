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
import { isConflict } from '@/api/errors';
import { fromSource } from '@/api/source';
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

/**
 * Queued writes of the Bugün slice. Paused mutations are persisted without their function, so every
 * write registers its `mutationFn` here by key to resume after an app restart.
 */
export function registerTodayMutations(client: QueryClient): void {
  const refreshPlans = () => {
    void client.invalidateQueries({ queryKey: planKeys.planDays });
    void client.invalidateQueries({ queryKey: queryKeys.today });
  };

  // 07 / 09 — PUT v1/tenant/plan-day/{date} (versioned).
  client.setMutationDefaults(todayMutationKeys.putPlanDay, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: PutPlanDayVariables) => {
      const body: PutPlanDayRequest = { occasion: vars.occasion, lookId: vars.lookId, baseVersion: vars.baseVersion, clientMutationId: vars.clientMutationId };
      return fromSource<PlanDay | null>(
        'today',
        () => fixturePutPlanDay(vars.date, body.occasion, body.lookId),
        () => apiRequest<PlanDay | null>(`v1/tenant/plan-day/${vars.date}`, { method: 'PUT', body }),
      );
    },
    onMutate: async (vars: PutPlanDayVariables) => {
      await client.cancelQueries({ queryKey: planKeys.planDays });
      patchPlanCaches(client, vars);
    },
    onSuccess: refreshPlans,
    onError: (error: unknown, vars: PutPlanDayVariables) => {
      if (isConflict(error)) {
        const current = error.problem?.current as PlanDay | undefined;
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

  // 06 heart — ASSUMPTION: PUT v1/tenant/look/{id}/favorite.
  client.setMutationDefaults(todayMutationKeys.setLookFavorite, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: SetLookFavoriteVariables) => {
      const body: PutLookFavoriteRequest = { isFavorite: vars.isFavorite, clientMutationId: vars.clientMutationId };
      return fromSource<void>(
        'today',
        () => fixtureSetLookFavorite(vars.lookId, body.isFavorite),
        () => apiRequest<void>(`v1/tenant/look/${vars.lookId}/favorite`, { method: 'PUT', body }),
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

  // 08 "İzleme listeme ekle" — ASSUMPTION: POST v1/tenant/watchlist (screen 24b is the store slice's).
  client.setMutationDefaults(todayMutationKeys.addToWatchlist, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: AddWatchlistVariables) => {
      const body: AddWatchlistRequest = { productId: vars.productId, clientMutationId: vars.clientMutationId };
      return fromSource<void>(
        'today',
        () => fixtureAddToWatchlist(body.productId),
        () => apiRequest<void>('v1/tenant/watchlist', { method: 'POST', body }),
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
    onError: () => void client.invalidateQueries({ queryKey: planKeys.edits }),
  });

  // 08 heart — ASSUMPTION: POST v1/tenant/look/from-edit.
  client.setMutationDefaults(todayMutationKeys.saveEditLook, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: SaveEditLookVariables) => {
      const body: SaveEditLookRequest = { id: vars.id, editLookId: vars.editLookId, band: vars.band, clientMutationId: vars.clientMutationId };
      return fromSource<void>(
        'today',
        () => fixtureSaveEditLook(body),
        () => apiRequest<void>('v1/tenant/look/from-edit', { method: 'POST', body }),
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
