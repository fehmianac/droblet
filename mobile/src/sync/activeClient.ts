import type { QueryClient } from '@tanstack/react-query';

/**
 * The QueryClient of the signed-in user, for code that runs outside React (wire mappers that join a
 * response with the cached wardrobe / catalogue). Set by `QueryProvider`; null in unit tests that
 * do not mount it — callers then fetch without the cache.
 */
let active: QueryClient | null = null;

export function setActiveQueryClient(client: QueryClient | null): void {
  active = client;
}

export function getActiveQueryClient(): QueryClient | null {
  return active;
}
