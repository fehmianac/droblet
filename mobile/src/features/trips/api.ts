import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type { City, PackTripRequest, PackTripResponse, Trip, TripDetail, TripFields, TripPlan } from '@/api/contracts/trips';
import { useJob } from '@/api/jobs';
import { fromSource } from '@/api/dataSource';
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

/** 18 Bavullar — upcoming and past trips. */
export function useTrips() {
  return useQuery({
    queryKey: tripKeys.trips,
    queryFn: () =>
      fromSource<Trip[]>(
        'wardrobe',
        () => fixtureListTrips(),
        () => apiRequest<Trip[]>('v1/tenant/trip'),
      ),
  });
}

/** 19 Bavul detayı — list, daily looks, forecast, missing pieces. */
export function useTrip(id: string) {
  return useQuery({
    queryKey: tripKeys.trip(id),
    enabled: Boolean(id),
    queryFn: () =>
      fromSource<TripDetail>(
        'wardrobe',
        () => fixtureGetTrip(id),
        () => apiRequest<TripDetail>(`v1/tenant/trip/${id}`),
      ),
  });
}

/** City autocomplete (18). Needs a connection; results are not persisted. */
export function useCitySearch(query: string) {
  const q = foldForSearch(query);
  return useQuery({
    queryKey: ['weather', 'city', q] as const,
    enabled: q.length >= CITY_QUERY_MIN,
    queryFn: () =>
      fromSource<City[]>(
        'wardrobe',
        () => fixtureSearchCities(query),
        () => apiRequest<City[]>(`v1/weather/city?q=${encodeURIComponent(query.trim())}`),
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
        request: { ...fields(draft), baseVersion: trip.baseVersion, clientMutationId: newClientMutation().clientMutationId },
        optimistic: { ...trip, ...fields(draft), cityName: draft.city.name, region: draft.city.region },
      });
    },
    setCabinOnly: (trip: TripDetail, cabinOnly: boolean): void => {
      put.mutate({
        id: trip.id,
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
 * Starts the AI packing job. Not queued offline — AI calls need a connection. `requestId` is stable
 * per attempt, so a retried request opens one job; the job id is written into the trip in the cache
 * so a reopened screen resumes it.
 */
export function useStartPack(tripId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: PackTripRequest) =>
      fromSource<PackTripResponse>(
        'wardrobe',
        () => fixtureStartPack(tripId, request),
        () => apiRequest<PackTripResponse>(`v1/tenant/trip/${tripId}/pack`, { method: 'POST', body: request }),
      ),
    onSuccess: ({ jobId }) => {
      client.setQueryData<TripDetail>(tripKeys.trip(tripId), (prev) => (prev ? { ...prev, packJobId: jobId } : prev));
    },
  });
}

/** Polls the packing job; its result is a draft `TripPlan` the user must accept. */
export function usePackJob(jobId: string | null | undefined, options: { enabled?: boolean } = {}) {
  return useJob<TripPlan>('trip-pack', jobId, options);
}
