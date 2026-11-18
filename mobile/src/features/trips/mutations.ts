import type { QueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type { AcceptPackRequest, CheckTripItemRequest, CreateTripRequest, PutTripRequest, Trip, TripDetail, TripPlan } from '@/api/contracts/trips';
import { isConflict, isGone } from '@/api/errors';
import { fromSource } from '@/api/dataSource';
import { fixtureAcceptPack, fixtureCheckTripItem, fixtureCreateTrip, fixtureDeleteTrip, fixturePutTrip } from '@/fixtures/trips';
import { ulid } from '@/lib/ids';
import { conflictStore } from '@/sync/conflicts';
import { TENANT_WRITE_SCOPE } from '@/sync/queryKeys';

/** Query keys of the trips feature (E5). */
export const tripKeys = {
  trips: ['tenant', 'trip'] as const,
  trip: (id: string) => ['tenant', 'trip', id] as const,
};

export const tripMutationKeys = {
  create: ['tenant', 'trip', 'create'] as const,
  put: ['tenant', 'trip', 'put'] as const,
  remove: ['tenant', 'trip', 'delete'] as const,
  checkItem: ['tenant', 'trip', 'item', 'check'] as const,
  acceptPack: ['tenant', 'trip', 'pack', 'accept'] as const,
};

export type CreateTripVariables = { request: CreateTripRequest; optimistic: TripDetail };
export type PutTripVariables = { id: string; request: PutTripRequest; optimistic: TripDetail };
export type DeleteTripVariables = { id: string; clientMutationId: string };
export type CheckTripItemVariables = { tripId: string; itemId: string; request: CheckTripItemRequest };
/** `plan` is the draft the user saw and accepted — shown optimistically until the server confirms. */
export type AcceptPackVariables = { tripId: string; jobId: string; request: AcceptPackRequest; plan: TripPlan };

export function withTripCounts(trip: TripDetail): TripDetail {
  return {
    ...trip,
    itemCount: trip.items.length,
    packedCount: trip.items.filter((i) => i.packed).length,
    lookCount: trip.days.filter((d) => d.look).length,
  };
}

export function tripSummary(detail: TripDetail): Trip {
  const d = withTripCounts(detail);
  return {
    id: d.id,
    cityId: d.cityId,
    cityName: d.cityName,
    region: d.region,
    startDate: d.startDate,
    endDate: d.endDate,
    tripTypes: d.tripTypes,
    cabinOnly: d.cabinOnly,
    status: d.status,
    packJobId: d.packJobId,
    itemCount: d.itemCount,
    packedCount: d.packedCount,
    lookCount: d.lookCount,
    createdAt: d.createdAt,
    baseVersion: d.baseVersion,
  };
}

function writeTrip(client: QueryClient, detail: TripDetail): void {
  const counted = withTripCounts(detail);
  const summary = tripSummary(counted);
  client.setQueryData<TripDetail>(tripKeys.trip(counted.id), counted);
  client.setQueryData<Trip[]>(tripKeys.trips, (prev) =>
    prev ? (prev.some((t) => t.id === summary.id) ? prev.map((t) => (t.id === summary.id ? summary : t)) : [summary, ...prev]) : prev,
  );
}

/** Registered from `registerLooksMutations` (the looks + trips slice shares one registration entry). */
export function registerTripMutations(client: QueryClient): void {
  const invalidate = () => void client.invalidateQueries({ queryKey: tripKeys.trips });
  const rerun = <V>(key: readonly string[], vars: V) =>
    void client.getMutationCache().build(client, { mutationKey: key, scope: TENANT_WRITE_SCOPE }).execute(vars);

  client.setMutationDefaults(tripMutationKeys.create, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: CreateTripVariables) =>
      fromSource<TripDetail>(
        'wardrobe',
        () => fixtureCreateTrip(vars.request),
        () => apiRequest<TripDetail>('v1/tenant/trip', { method: 'POST', body: vars.request }),
      ),
    onMutate: async (vars: CreateTripVariables) => {
      await client.cancelQueries({ queryKey: tripKeys.trips });
      writeTrip(client, vars.optimistic);
    },
    onSuccess: (saved: TripDetail | undefined) => {
      if (saved) writeTrip(client, saved);
    },
    onError: invalidate,
  });

  client.setMutationDefaults(tripMutationKeys.put, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: PutTripVariables) => {
      const cached = client.getQueryData<TripDetail>(tripKeys.trip(vars.id))?.baseVersion ?? 0;
      const request: PutTripRequest = { ...vars.request, baseVersion: Math.max(vars.request.baseVersion, cached) };
      return fromSource<TripDetail>(
        'wardrobe',
        () => fixturePutTrip(vars.id, request),
        () => apiRequest<TripDetail>(`v1/tenant/trip/${vars.id}`, { method: 'PUT', body: request }),
      );
    },
    onMutate: async (vars: PutTripVariables) => {
      await client.cancelQueries({ queryKey: tripKeys.trips });
      writeTrip(client, vars.optimistic);
    },
    onSuccess: (saved: TripDetail | undefined) => {
      if (saved) writeTrip(client, saved);
    },
    onError: (error: unknown, vars: PutTripVariables) => {
      if (isConflict(error)) {
        const current = error.problem?.current as Trip | undefined;
        conflictStore.push({
          id: vars.request.clientMutationId,
          kind: 'changed',
          keepTheirs: invalidate,
          keepMine: current
            ? () =>
                rerun<PutTripVariables>(tripMutationKeys.put, {
                  ...vars,
                  optimistic: { ...vars.optimistic, baseVersion: current.baseVersion },
                  request: { ...vars.request, baseVersion: current.baseVersion, clientMutationId: ulid() },
                })
            : undefined,
        });
      } else if (isGone(error)) {
        conflictStore.push({ id: vars.request.clientMutationId, kind: 'deleted', keepTheirs: invalidate });
      }
      invalidate();
    },
  });

  client.setMutationDefaults(tripMutationKeys.remove, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: DeleteTripVariables) =>
      fromSource<void>(
        'wardrobe',
        () => fixtureDeleteTrip(vars.id),
        () => apiRequest<void>(`v1/tenant/trip/${vars.id}`, { method: 'DELETE' }),
      ),
    onMutate: async (vars: DeleteTripVariables) => {
      await client.cancelQueries({ queryKey: tripKeys.trips });
      client.setQueryData<Trip[]>(tripKeys.trips, (prev) => prev?.filter((t) => t.id !== vars.id));
      client.removeQueries({ queryKey: tripKeys.trip(vars.id), exact: true });
    },
    onError: (error: unknown) => {
      if (!isGone(error)) invalidate();
    },
  });

  client.setMutationDefaults(tripMutationKeys.checkItem, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: CheckTripItemVariables) =>
      fromSource<void>(
        'wardrobe',
        () => fixtureCheckTripItem(vars.tripId, vars.itemId, vars.request),
        () => apiRequest<void>(`v1/tenant/trip/${vars.tripId}/item/${vars.itemId}`, { method: 'PUT', body: vars.request }),
      ),
    onMutate: async (vars: CheckTripItemVariables) => {
      await client.cancelQueries({ queryKey: tripKeys.trip(vars.tripId) });
      const detail = client.getQueryData<TripDetail>(tripKeys.trip(vars.tripId));
      if (detail) {
        writeTrip(client, {
          ...detail,
          items: detail.items.map((i) => (i.itemId === vars.itemId ? { ...i, packed: vars.request.packed } : i)),
        });
      }
    },
    onError: invalidate,
  });

  client.setMutationDefaults(tripMutationKeys.acceptPack, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: AcceptPackVariables) =>
      fromSource<TripDetail>(
        'wardrobe',
        () => fixtureAcceptPack(vars.tripId),
        () => apiRequest<TripDetail>(`v1/tenant/trip/${vars.tripId}/pack/${vars.jobId}/accept`, { method: 'POST', body: vars.request }),
      ),
    onMutate: async (vars: AcceptPackVariables) => {
      await client.cancelQueries({ queryKey: tripKeys.trip(vars.tripId) });
      const detail = client.getQueryData<TripDetail>(tripKeys.trip(vars.tripId));
      if (detail) writeTrip(client, { ...detail, ...vars.plan, status: 'packed', packJobId: null });
    },
    onSuccess: (saved: TripDetail | undefined) => {
      if (saved) writeTrip(client, saved);
    },
    onError: invalidate,
  });
}
