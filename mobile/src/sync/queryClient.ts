import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { defaultShouldDehydrateQuery, QueryClient, type Query } from '@tanstack/react-query';

import { ApiError } from '@/api/errors';

import { registerMutationDefaults } from './mutationFns';

/** Bump when a persisted shape changes incompatibly; old caches are discarded. */
export const CACHE_BUSTER = 'v1';
export const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.kind === 'config' || error.kind === 'session_expired') return false;
    if (error.status !== null && error.status >= 400 && error.status < 500 && error.status !== 429) {
      return false;
    }
  }
  return failureCount < 3;
}

export function createQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: CACHE_MAX_AGE_MS,
        retry: shouldRetry,
        networkMode: 'offlineFirst',
      },
      mutations: {
        retry: shouldRetry,
        // Writes pause while offline and resume in order (shared scope) when the connection returns.
        networkMode: 'online',
      },
    },
  });
  registerMutationDefaults(client);
  return client;
}

/** One persisted cache + mutation queue per user, so another account never receives this queue. */
export function createPersister(userId: string) {
  return createAsyncStoragePersister({
    storage: AsyncStorage,
    key: `droblet.query.${userId}`,
    throttleTime: 1000,
  });
}

export const dehydrateOptions = {
  shouldDehydrateQuery: (query: Query) =>
    defaultShouldDehydrateQuery(query) && query.meta?.persist !== false,
};
