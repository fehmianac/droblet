import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { defaultShouldDehydrateQuery, MutationCache, QueryCache, QueryClient, type Query } from '@tanstack/react-query';

import { ApiError, isConsentRequired, isNotFound, missingConsents } from '@/api/errors';
import { consentRequests } from '@/features/consent/store';

import { registerMutationDefaults } from './mutationFns';

/**
 * Bump when a persisted shape changes incompatibly; old caches are discarded.
 * v3: the weekly-edit detail and the Keşfet cover no longer share `['content','edit','current']` (a cache
 * written by an older build could crash Keşfet), and the real-API mappers changed several cached shapes.
 */
export const CACHE_BUSTER = 'v3';
export const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

function shouldRetry(failureCount: number, error: unknown): boolean {
  // Not there (404 / 410, a fixture miss): a retry cannot bring it back, and the screen shows its not-found state at once.
  if (isNotFound(error)) return false;
  if (error instanceof ApiError) {
    if (error.kind === 'config' || error.kind === 'session_expired') return false;
    if (error.status !== null && error.status >= 400 && error.status < 500 && error.status !== 429) {
      return false;
    }
  }
  return failureCount < 3;
}

/**
 * 403 `consent_required` from ANY request (a queued photo upload, a try-on, the palette…): the server
 * says which consents are missing, and the consent sheet asks for exactly those. The request itself is
 * not replayed — the user starts the feature again once the consent is recorded.
 */
function askForMissingConsents(error: unknown): void {
  if (!isConsentRequired(error)) return;
  const missing = missingConsents(error);
  if (missing.length > 0) void consentRequests.request(missing, 'server');
}

export function createQueryClient(): QueryClient {
  const client = new QueryClient({
    queryCache: new QueryCache({ onError: askForMissingConsents }),
    mutationCache: new MutationCache({ onError: askForMissingConsents }),
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
