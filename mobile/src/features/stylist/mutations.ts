import type { QueryClient } from '@tanstack/react-query';

/**
 * Queued writes of the stylist feature. Paused mutations are persisted without their function, so every
 * write must register its `mutationFn` here by key to resume after an app restart.
 */
export function registerStylistMutations(client: QueryClient): void {
  void client;
}
