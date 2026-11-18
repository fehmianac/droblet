import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { buildTodayFixture, libraryFixture, withLatency } from '@/fixtures/today';
import { toIsoDate } from '@/lib/format';
import { newClientMutation } from '@/sync/clientMutation';
import { mutationKeys, queryKeys } from '@/sync/queryKeys';

import type { LibraryItem, TodayResponse, WearLogRequest } from './contracts';

/** 06 Bugün — fixture-backed until the E4 contract (candidate `GET v1/tenant/today`) is agreed. */
export function useToday() {
  return useQuery({
    queryKey: queryKeys.today,
    queryFn: (): Promise<TodayResponse> => withLatency(buildTodayFixture()),
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
    wear: (lookId: string) =>
      m.mutate({ lookId, date: toIsoDate(new Date()), ...newClientMutation() }),
  };
}

/** Ready-made piece library (04b / 12b) — fixture-backed until E2 (candidate `GET v1/catalog/library`). */
export function useItemLibrary() {
  return useQuery({
    queryKey: queryKeys.library,
    queryFn: (): Promise<LibraryItem[]> => withLatency(libraryFixture),
  });
}
