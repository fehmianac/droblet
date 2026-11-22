import type { QueryClient } from '@tanstack/react-query';

import { registerAnalyticsMutation } from '@/analytics/AnalyticsHost';
import { registerAccountMutations } from '@/features/account/mutations';
import { registerFeedMutations } from '@/features/feed/mutations';
import { registerNotificationMutations } from '@/features/notifications/mutations';
import { registerSocialMutations } from '@/features/social/mutations';
import { registerStoreMutations } from '@/features/store/mutations';

/**
 * Queued writes of the feature modules (E7–E9, E11, Akış, analytics). Each module registers its own
 * mutation functions next to its hooks; this is the single place `registerMutationDefaults` calls.
 */
export function registerFeatureMutations(client: QueryClient): void {
  registerStoreMutations(client);
  registerSocialMutations(client);
  registerFeedMutations(client);
  registerAccountMutations(client);
  registerNotificationMutations(client);
  registerAnalyticsMutation(client);
}
