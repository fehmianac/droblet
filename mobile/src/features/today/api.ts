import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type { Occasion, TodayResponse } from '@/api/contracts';
import type {
  CalendarMonth,
  PlanDay,
  PlanWeekRequest,
  PlanWeekResponse,
  PlanWeekResult,
  PriceBand,
  RefreshTodayRequest,
  WearLog,
  WearSummary,
  WeeklyEdit,
} from '@/api/contracts/today';
import { useJob } from '@/api/jobs';
import { fromSource } from '@/api/dataSource';
import { startFixtureJob } from '@/fixtures/jobs';
import { fixtureCalendarMonth, fixtureListPlanDays, fixturePlanWeek, fixtureRefreshToday, fixtureWeeklyEdit } from '@/fixtures/today';
import { ulid } from '@/lib/ids';
import { newClientMutation } from '@/sync/clientMutation';
import { queryKeys } from '@/sync/queryKeys';

import { monthBounds } from './dates';
import { planKeys, todayMutationKeys } from './keys';
import type { AddWatchlistVariables, PutPlanDayVariables, SaveEditLookVariables, SetLookFavoriteVariables } from './mutations';

/** 07 — plan days of a date range (only days that have a record). */
export function usePlanDays(from: string, to: string) {
  return useQuery({
    queryKey: planKeys.planRange(from, to),
    queryFn: () =>
      fromSource<PlanDay[]>(
        'today',
        () => fixtureListPlanDays(from, to),
        () => apiRequest<PlanDay[]>(`v1/tenant/plan-day?from=${from}&to=${to}`),
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

/** 09 — one month: wear logs, plan days and the summary. */
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
            apiRequest<WearLog[]>(`v1/tenant/wear-log?month=${month}`),
            apiRequest<PlanDay[]>(`v1/tenant/plan-day?from=${from}&to=${to}`),
            apiRequest<WearSummary>(`v1/tenant/wear-log/summary?month=${month}`),
          ]);
          return { month, wearLogs, planDays, summary };
        },
      ),
  });
}

/** 08 — the weekly edit (`current` or an edit id). Global content; cached like everything else. */
export function useWeeklyEdit(id: string) {
  return useQuery({
    queryKey: planKeys.edit(id),
    queryFn: () =>
      fromSource<WeeklyEdit>(
        'today',
        () => fixtureWeeklyEdit(id),
        () => apiRequest<WeeklyEdit>(`v1/content/edit/${id}`),
      ),
  });
}

/** 06 "Başka öneri" — needs a connection (AI), so it is not queued. */
export function useRefreshTodayLook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (date: string) => {
      const body: RefreshTodayRequest = { date, requestId: ulid() };
      return fromSource<TodayResponse>(
        'today',
        () => fixtureRefreshToday(date),
        () => apiRequest<TodayResponse>('v1/tenant/today/refresh', { method: 'POST', body }),
      );
    },
    onSuccess: (data) => {
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

/** 08 — "İzleme listeme ekle" (price-drop watch, separate from the heart). */
export function useAddToWatchlist() {
  const m = useMutation<void, unknown, AddWatchlistVariables>({ mutationKey: todayMutationKeys.addToWatchlist });
  return { ...m, add: (productId: string) => m.mutate({ productId, ...newClientMutation() }) };
}

/** 08 heart — saves the edit look to the lookbook. */
export function useSaveEditLook() {
  const m = useMutation<void, unknown, SaveEditLookVariables>({ mutationKey: todayMutationKeys.saveEditLook });
  return { ...m, save: (editLookId: string, band: PriceBand) => m.mutate({ id: ulid(), editLookId, band, ...newClientMutation() }) };
}

/** 07 "Haftamı planla" — starts a `stylist-week` job (text only, no credit). */
export function useStartPlanWeek() {
  return useMutation({
    mutationFn: (input: Omit<PlanWeekRequest, 'requestId'>) => {
      const request: PlanWeekRequest = { ...input, requestId: ulid() };
      return fromSource<PlanWeekResponse>(
        'today',
        () => ({ jobId: startFixtureJob<PlanWeekResult>('stylist-week', () => fixturePlanWeek(request), { id: `job_${request.requestId}` }) }),
        () => apiRequest<PlanWeekResponse>('v1/tenant/stylist/week', { method: 'POST', body: request }),
      );
    },
  });
}

export function usePlanWeekJob(jobId: string | null, enabled: boolean) {
  return useJob<PlanWeekResult>('stylist-week', jobId, { enabled });
}
