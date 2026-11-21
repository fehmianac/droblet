import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type { City, PackTripRequest, PackTripResponse, Trip, TripDetail, TripFields, TripPlan } from '@/api/contracts/trips';
import { useJob } from '@/api/jobs';
import { fromSource } from '@/api/dataSource';
import type { JobWire } from '@/api/wire/core';
import { mapPackResult, toTrip, toTripDetailAsync, type TripDetailWire, type TripWire } from '@/api/wire/trips';
import { toCity, type CityWire } from '@/api/wire/weather';
import { routeAiStartError } from '@/features/credits/aiErrors';
import { refreshTeenStylist } from '@/features/teen/store';
import { fixtureGetTrip, fixtureListTrips, fixtureSearchCities, fixtureStartPack } from '@/fixtures/trips';
import { ulid } from '@/lib/ids';
import { newClientMutation } from '@/sync/clientMutation';

import { CITY_QUERY_MIN, foldForSearch } from './logic';
import {
  tripKeys,
  tripMutationKeys,
  type AcceptPackVariables,
  type CheckTripItemVariables,
  type CreateTripVariables,
  type DeleteTripVariables,
  type PutTripVariables,
} from './mutations';

/** What only the device knows about a trip: the city's region line and a running pack job. */
function localTripState(client: QueryClient, id: string) {
  const cached = client.getQueryData<TripDetail>(tripKeys.trip(id)) ?? client.getQueryData<Trip[]>(tripKeys.trips)?.find((t) => t.id === id);
  return {
    region: cached?.region,
    packJobId: client.getQueryData<string | null>(tripKeys.packJob(id)) ?? cached?.packJobId ?? null,
  };
}

/** 18 Bavullar — `GET v1/tenant/trip`: upcoming and past trips, by start date. */
export function useTrips() {
  const client = useQueryClient();
  return useQuery({
    queryKey: tripKeys.trips,
    queryFn: () =>
      fromSource<Trip[]>(
        'wardrobe',
        () => fixtureListTrips(),
        async () => (await apiRequest<TripWire[]>('v1/tenant/trip')).map((t) => toTrip(t, localTripState(client, t.id))),
      ),
  });
}

/** 19 Bavul detayı — `GET v1/tenant/trip/{id}`: list, daily looks, forecast, missing pieces (404 = gone). */
export function useTrip(id: string) {
  const client = useQueryClient();
  return useQuery({
    queryKey: tripKeys.trip(id),
    enabled: Boolean(id),
    queryFn: () =>
      fromSource<TripDetail>(
        'wardrobe',
        () => fixtureGetTrip(id),
        async () => toTripDetailAsync(await apiRequest<TripDetailWire>(`v1/tenant/trip/${id}`), localTripState(client, id)),
      ),
  });
}

/** City autocomplete (18) — `GET v1/weather/city?q=` (2–60 chars, ≤ 8 results). Needs a connection; not persisted. */
export function useCitySearch(query: string) {
  const q = foldForSearch(query);
  return useQuery({
    queryKey: ['weather', 'city', q] as const,
    enabled: q.length >= CITY_QUERY_MIN,
    queryFn: () =>
      fromSource<City[]>(
        'wardrobe',
        () => fixtureSearchCities(query),
        async () => (await apiRequest<CityWire[]>(`v1/weather/city?q=${encodeURIComponent(query.trim())}`)).map(toCity),
      ),
    staleTime: 5 * 60_000,
    meta: { persist: false },
  });
}

export type TripDraft = TripFields & { city: City };

/** Trip writes — queued, optimistic, stable `clientMutationId`. */
export function useTripWrites() {
  const create = useMutation<TripDetail, unknown, CreateTripVariables>({ mutationKey: tripMutationKeys.create });
  const put = useMutation<TripDetail, unknown, PutTripVariables>({ mutationKey: tripMutationKeys.put });
  const remove = useMutation<void, unknown, DeleteTripVariables>({ mutationKey: tripMutationKeys.remove });
  const check = useMutation<void, unknown, CheckTripItemVariables>({ mutationKey: tripMutationKeys.checkItem });
  const accept = useMutation<TripDetail, unknown, AcceptPackVariables>({ mutationKey: tripMutationKeys.acceptPack });

  const fields = (draft: TripDraft): TripFields => ({
    cityId: draft.cityId,
    startDate: draft.startDate,
    endDate: draft.endDate,
    tripTypes: draft.tripTypes,
    cabinOnly: draft.cabinOnly,
  });

  return {
    /** Returns the new trip's id immediately (the write may still be queued). */
    create: (draft: TripDraft): string => {
      const id = ulid();
      const { clientMutationId, occurredAt } = newClientMutation();
      create.mutate({
        request: { id, ...fields(draft), clientMutationId },
        cityName: draft.city.name,
        optimistic: {
          id,
          ...fields(draft),
          cityName: draft.city.name,
          region: draft.city.region,
          status: 'new',
          packJobId: null,
          itemCount: 0,
          packedCount: 0,
          lookCount: 0,
          createdAt: occurredAt,
          baseVersion: 0,
          items: [],
          days: [],
          missing: [],
          minWearsPerItem: null,
          forecast: null,
        },
      });
      return id;
    },
    update: (trip: TripDetail, draft: TripDraft): void => {
      put.mutate({
        id: trip.id,
        cityName: draft.city.name,
        request: { ...fields(draft), baseVersion: trip.baseVersion, clientMutationId: newClientMutation().clientMutationId },
        optimistic: { ...trip, ...fields(draft), cityName: draft.city.name, region: draft.city.region },
      });
    },
    setCabinOnly: (trip: TripDetail, cabinOnly: boolean): void => {
      put.mutate({
        id: trip.id,
        cityName: trip.cityName,
        request: {
          cityId: trip.cityId,
          startDate: trip.startDate,
          endDate: trip.endDate,
          tripTypes: trip.tripTypes,
          cabinOnly,
          baseVersion: trip.baseVersion,
          clientMutationId: newClientMutation().clientMutationId,
        },
        optimistic: { ...trip, cabinOnly },
      });
    },
    remove: (id: string): void => {
      remove.mutate({ id, clientMutationId: newClientMutation().clientMutationId });
    },
    setPacked: (tripId: string, itemId: string, packed: boolean): void => {
      check.mutate({ tripId, itemId, request: { packed, ...newClientMutation() } });
    },
    acceptPack: (tripId: string, jobId: string, plan: TripPlan): void => {
      accept.mutate({ tripId, jobId, plan, request: { clientMutationId: newClientMutation().clientMutationId } });
    },
  };
}

/**
 * Starts the AI packing job (`POST v1/tenant/trip/{id}/pack` → 202 job; 403 `premium_required` opens
 * the paywall). Not queued offline — AI calls need a connection. `requestId` is stable per attempt,
 * so a retried request opens one job; the job id is kept in the cache (the server does not list a
 * trip's jobs) so a reopened screen resumes it.
 */
export function useStartPack(tripId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: PackTripRequest) =>
      fromSource<PackTripResponse>(
        'wardrobe',
        () => fixtureStartPack(tripId, request),
        async () => {
          const job = await apiRequest<JobWire>(`v1/tenant/trip/${tripId}/pack`, { method: 'POST', body: { requestId: request.requestId } });
          return { jobId: job.id };
        },
      ),
    onSuccess: ({ jobId }) => {
      client.setQueryData<string | null>(tripKeys.packJob(tripId), jobId);
      client.setQueryData<TripDetail>(tripKeys.trip(tripId), (prev) => (prev ? { ...prev, packJobId: jobId } : prev));
      refreshTeenStylist();
    },
    onError: (error) => void routeAiStartError(error, 'suitcase'),
  });
}

/** Polls the packing job; its result is a draft `TripPlan` the user must accept. */
export function usePackJob(jobId: string | null | undefined, options: { enabled?: boolean } = {}) {
  return useJob<TripPlan>('trip-pack', jobId, { ...options, mapResult: mapPackResult });
}

/**
 * Archive (`POST v1/tenant/trip/{id}/archive`) / unarchive (`DELETE` on the same path) → the wire trip.
 * Online; the list is refreshed afterwards.
 */
export function useArchiveTrip() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      fromSource<Trip | null>(
        'wardrobe',
        () => null,
        async () =>
          toTrip(
            await apiRequest<TripWire>(`v1/tenant/trip/${id}/archive`, { method: archived ? 'POST' : 'DELETE' }),
            localTripState(client, id),
          ),
      ),
    onSuccess: (trip) => {
      if (trip) client.setQueryData<Trip[]>(tripKeys.trips, (prev) => prev?.map((t) => (t.id === trip.id ? trip : t)));
      void client.invalidateQueries({ queryKey: tripKeys.trips });
    },
  });
}
