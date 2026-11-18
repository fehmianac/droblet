import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';

import { apiRequest } from '@/api/client';
import type { Occasion, TodayResponse } from '@/api/contracts';
import type { CalendarMonth, PlanDay, PlanWeekRequest, PlanWeekResponse, PlanWeekResult, PriceBand, WeeklyEdit } from '@/api/contracts/today';
import type { StylistOutfitRequest } from '@/api/contracts/stylist';
import { fromSource } from '@/api/dataSource';
import { ApiError, isPaywallError } from '@/api/errors';
import { useJob } from '@/api/jobs';
import type { JobWire, PhotosWire } from '@/api/wire/core';
import {
  NO_EDIT_USER_STATE,
  toPlanDay,
  toPlanWeekResult,
  toWearLog,
  toWearSummary,
  toWeeklyEdit,
  type EditUserState,
  type EditWire,
  type PlanDayWire,
  type StartWeekWire,
  type WearLogWire,
  type WearSummaryWire,
  type WeekResultWire,
} from '@/api/wire/today';
import { fromOccasion, ITEMS_QUERY_KEY, type ItemWire, type LookWire } from '@/api/wire/wardrobe';
import { lookKeys } from '@/features/looks/queries';
import { startFixtureJob } from '@/fixtures/jobs';
import {
  fixtureCalendarMonth,
  fixtureListPlanDays,
  fixturePlanWeek,
  fixturePutPlanDay,
  fixtureRefreshToday,
  fixtureWeeklyEdit,
} from '@/fixtures/today';
import i18n from '@/i18n';
import { ulid } from '@/lib/ids';
import { newClientMutation } from '@/sync/clientMutation';
import { queryKeys } from '@/sync/queryKeys';

import { monthBounds } from './dates';
import { planKeys, todayMutationKeys } from './keys';
import type { AddWatchlistVariables, PutPlanDayVariables, SaveEditLookVariables, SetLookFavoriteVariables } from './mutations';

/** GET v1/tenant/plan-day?from=&to= (inclusive, ≤ 62 days) → only days that have a record. */
export async function requestPlanDays(from: string, to: string): Promise<PlanDay[]> {
  return (await apiRequest<PlanDayWire[]>(`v1/tenant/plan-day?from=${from}&to=${to}`)).map(toPlanDay);
}

/** 07 — plan days of a date range (only days that have a record). */
export function usePlanDays(from: string, to: string) {
  return useQuery({
    queryKey: planKeys.planRange(from, to),
    queryFn: () =>
      fromSource<PlanDay[]>(
        'today',
        () => fixtureListPlanDays(from, to),
        () => requestPlanDays(from, to),
      ),
  });
}

/** 07 ⋯ menu / 09 — sets or clears a day's look through the write queue (optimistic, versioned). */
export function usePutPlanDay() {
  const m = useMutation<PlanDay | null, unknown, PutPlanDayVariables>({ mutationKey: todayMutationKeys.putPlanDay });
  return {
    ...m,
    put: (current: PlanDay | null, date: string, next: { occasion: Occasion | null; lookId: string | null }) =>
      m.mutate({ date, ...next, baseVersion: current?.baseVersion ?? 0, ...newClientMutation() }),
  };
}

/** 09 — one month: wear logs, plan days and the summary (three GETs). */
export function useCalendarMonth(month: string) {
  return useQuery({
    queryKey: planKeys.calendar(month),
    queryFn: () =>
      fromSource<CalendarMonth>(
        'today',
        () => fixtureCalendarMonth(month),
        async () => {
          const { from, to } = monthBounds(month);
          const [wearLogs, planDays, summary] = await Promise.all([
            apiRequest<WearLogWire[]>(`v1/tenant/wear-log?month=${month}`),
            requestPlanDays(from, to),
            apiRequest<WearSummaryWire>(`v1/tenant/wear-log/summary?month=${month}`),
          ]);
          return { month, wearLogs: wearLogs.map(toWearLog), planDays, summary: toWearSummary(summary) };
        },
      ),
  });
}

/** 09 — undo a "Bunu giyiyorum" (`DELETE v1/tenant/wear-log/{date}/{id}` → 204; 404 = already gone). */
export function useUndoWearLog() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (log: { date: string; id: string }) => {
      try {
        await apiRequest<void>(`v1/tenant/wear-log/${log.date}/${log.id}`, { method: 'DELETE' });
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: planKeys.planDays });
      void client.invalidateQueries({ queryKey: queryKeys.today });
      void client.invalidateQueries({ queryKey: ITEMS_QUERY_KEY });
    },
  });
}

/** Any of the per-user reads may fail without failing the edit itself (it is shared content). */
async function orNull<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch {
    return null;
  }
}

/** What 08 shows per user: owned products, watched products, looks already saved, body photo. */
async function loadEditUserState(): Promise<EditUserState> {
  const [items, watch, looks, photos] = await Promise.all([
    orNull(apiRequest<ItemWire[]>('v1/tenant/item')),
    orNull(apiRequest<{ product: { id: string } }[]>('v1/tenant/watch-list')),
    orNull(apiRequest<LookWire[]>('v1/tenant/look')),
    orNull(apiRequest<PhotosWire>('v1/tenant/photo')),
  ]);
  const ownedByProduct = new Map<string, string>();
  items?.forEach((i) => {
    if (i.productId) ownedByProduct.set(i.productId, i.id);
  });
  return {
    ownedByProduct,
    watchedProductIds: new Set(watch?.map((w) => w.product.id) ?? []),
    savedLookNames: new Set(looks?.filter((l) => l.source === 'edit').map((l) => l.name) ?? []),
    hasBodyPhoto: Boolean(photos?.body),
  };
}

/**
 * 08 — the weekly edit: `GET v1/content/edit/current` or `GET v1/content/edit/{id}` (404 `not_found`
 * when nothing is published). Global content, joined with the user's wardrobe / watch list.
 */
export function useWeeklyEdit(id: string) {
  return useQuery({
    queryKey: planKeys.edit(id),
    queryFn: () =>
      fromSource<WeeklyEdit>(
        'today',
        () => fixtureWeeklyEdit(id),
        async () => {
          const [edit, state] = await Promise.all([
            apiRequest<EditWire>(`v1/content/edit/${encodeURIComponent(id)}`),
            loadEditUserState().catch(() => NO_EDIT_USER_STATE),
          ]);
          return toWeeklyEdit(edit, state);
        },
      ),
  });
}

/**
 * 06 "Başka öneri" — needs a connection (AI), so it is not queued. There is no `today/refresh` on the
 * server: the app asks the stylist for the day (`POST v1/tenant/stylist/outfit` → 202 job, members
 * only) and opens the suggestions screen (17), where the user accepts one. A non-member gets the
 * paywall (403 `premium_required`).
 */
export function useRefreshTodayLook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (date: string): Promise<TodayResponse | null> =>
      fromSource<TodayResponse | null>(
        'today',
        () => fixtureRefreshToday(date),
        async () => {
          const occasion = client.getQueryData<TodayResponse>(queryKeys.today)?.occasion ?? null;
          const request: StylistOutfitRequest = { requestId: ulid(), date, occasion, text: null, cityId: null, wardrobeOnly: true };
          try {
            const job = await apiRequest<JobWire>('v1/tenant/stylist/outfit', {
              method: 'POST',
              body: { requestId: request.requestId, date, occasion: fromOccasion(occasion), onlyMyWardrobe: true },
            });
            // Same cache entry the Stilist tab writes, so 17 can retry a failed job with the same input.
            client.setQueryData(['tenant', 'stylist', 'request', job.id], request);
            router.push({ pathname: '/stylist/[jobId]', params: { jobId: job.id } });
          } catch (e) {
            if (!isPaywallError(e)) throw e;
            router.push({ pathname: '/paywall', params: { from: 'stylist' } });
          }
          return null;
        },
      ),
    onSuccess: (data) => {
      if (!data) return;
      client.setQueryData(queryKeys.today, data);
      void client.invalidateQueries({ queryKey: planKeys.planDays });
    },
  });
}

/** 06 heart — lookbook favourite through the write queue (optimistic). */
export function useSetLookFavorite() {
  const m = useMutation<void, unknown, SetLookFavoriteVariables>({ mutationKey: todayMutationKeys.setLookFavorite });
  return { ...m, set: (lookId: string, isFavorite: boolean) => m.mutate({ lookId, isFavorite, ...newClientMutation() }) };
}

/** 08 — "İzleme listeme ekle" (price-drop watch, separate from the heart). `editLookId` = the look it was added from. */
export function useAddToWatchlist() {
  const m = useMutation<void, unknown, AddWatchlistVariables>({ mutationKey: todayMutationKeys.addToWatchlist });
  return { ...m, add: (productId: string, editLookId?: string) => m.mutate({ productId, editLookId, ...newClientMutation() }) };
}

/** 08 heart — saves the edit look to the lookbook (`POST v1/tenant/look`, `source: "edit"`). */
export function useSaveEditLook() {
  const m = useMutation<void, unknown, SaveEditLookVariables>({ mutationKey: todayMutationKeys.saveEditLook });
  return {
    ...m,
    save: (editLookId: string, band: PriceBand, editId?: string) => m.mutate({ id: ulid(), editLookId, band, editId, ...newClientMutation() }),
  };
}

/** 07 "Haftamı planla" — starts a `stylist-week` job (text only, no credit; 403 `premium_required` for non-members). */
export function useStartPlanWeek() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<PlanWeekRequest, 'requestId'>) => {
      const request: PlanWeekRequest = { ...input, requestId: ulid() };
      return fromSource<PlanWeekResponse>(
        'today',
        () => ({ jobId: startFixtureJob<PlanWeekResult>('stylist-week', () => fixturePlanWeek(request), { id: `job_${request.requestId}` }) }),
        async () => {
          const body: StartWeekWire = {
            requestId: request.requestId,
            weekStart: request.weekStart,
            days: request.days.map((d) => ({ date: d.date, occasion: fromOccasion(d.occasion) })),
            onlyMyWardrobe: true,
          };
          const job = await apiRequest<JobWire>('v1/tenant/stylist/week', { method: 'POST', body });
          return { jobId: job.id };
        },
      );
    },
    // The days the user asked for: the proposal sheet lists only those (the server drafts all seven).
    onSuccess: (accepted, input) => {
      client.setQueryData(planKeys.weekRequest(accepted.jobId), input.days.map((d) => d.date));
    },
    // 403 `premium_required`: the weekly planner is a member feature.
    onError: (error) => {
      if (isPaywallError(error)) router.push({ pathname: '/paywall', params: { from: 'stylist' } });
    },
  });
}

export function usePlanWeekJob(jobId: string | null, enabled: boolean) {
  const client = useQueryClient();
  return useJob<PlanWeekResult>('stylist-week', jobId, {
    enabled,
    mapResult: (result, job) =>
      toPlanWeekResult(result as WeekResultWire, {
        jobId: job.id,
        only: client.getQueryData<string[]>(planKeys.weekRequest(job.id)) ?? null,
        untitled: i18n.t('weekPlan.proposalUntitled'),
      }),
  });
}

/**
 * 07 "Planı kabul et" — the week draft becomes looks + plan days:
 * `POST v1/tenant/stylist/week/{jobId}/accept { clientMutationId, dates }` → `{ days: PlanDayDto[] }`
 * (404 `job_not_found`, 409 `job_not_completed` / `suggestion_stale`). Online: it follows an AI job.
 */
export function useAcceptPlanWeek() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (proposal: PlanWeekResult) =>
      fromSource<PlanDay[]>(
        'today',
        () =>
          proposal.days
            .map((d) => fixturePutPlanDay(d.date, d.occasion, d.lookId))
            .filter((d): d is PlanDay => d !== null),
        async () => {
          const res = await apiRequest<{ days: PlanDayWire[] }>(`v1/tenant/stylist/week/${proposal.jobId ?? ''}/accept`, {
            method: 'POST',
            body: { clientMutationId: ulid(), dates: proposal.days.map((d) => d.date) },
          });
          return res.days.map(toPlanDay);
        },
      ),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: planKeys.planDays });
      void client.invalidateQueries({ queryKey: lookKeys.looks });
      void client.invalidateQueries({ queryKey: queryKeys.today });
    },
  });
}
