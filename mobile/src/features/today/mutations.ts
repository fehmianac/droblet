import type { QueryClient } from '@tanstack/react-query';

/**
 * Queued writes of the today feature. Paused mutations are persisted without their function, so every
 * write must register its `mutationFn` here by key to resume after an app restart.
 */
export function registerTodayMutations(client: QueryClient): void {
  void client;
}
