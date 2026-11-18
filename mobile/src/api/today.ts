import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { planKeys } from '@/features/today/keys';
import { buildTodayFixture, fixtureLogWear, libraryFixture, withLatency } from '@/fixtures/today';
import { toIsoDate } from '@/lib/format';
import { newClientMutation } from '@/sync/clientMutation';
import { mutationKeys, queryKeys } from '@/sync/queryKeys';

import { apiRequest } from './client';
import type { LibraryItem, TodayResponse, WearLogRequest } from './contracts';
import { DATA_SOURCE, fromSource } from './dataSource';

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

/** Ready-made piece library (04b / 12b) — fixture-backed until E2 (candidate `GET v1/catalog/library`). */
export function useItemLibrary() {
  return useQuery({
    queryKey: queryKeys.library,
    queryFn: (): Promise<LibraryItem[]> => withLatency(libraryFixture),
  });
}
