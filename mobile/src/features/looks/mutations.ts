import type { QueryClient } from '@tanstack/react-query';

/**
 * Queued writes of the looks + trips slice. Paused mutations are persisted without their function, so
 * every write must register its `mutationFn` here by key to resume after an app restart.
 */
export function registerLooksMutations(client: QueryClient): void {
  void client;
}
