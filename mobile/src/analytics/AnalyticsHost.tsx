import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';

import { apiRequest } from '@/api/client';
import type { EventBatchRequest } from '@/api/contracts/analytics';
import { toEventBatchWire, type EventBatchResponseWire } from '@/api/wire/analytics';

import { bindAnalyticsSink, flushAnalytics } from './track';

export const analyticsMutationKey = ['tenant', 'event', 'batch'] as const;

/**
 * `POST v1/tenant/event` — the batch is converted to the server's vocabulary first (`wire/analytics`);
 * a batch with nothing the server takes from the client is not sent. Individually rejected events
 * (`rejected[]`) are dropped: the API says never to retry them.
 */
export async function sendEventBatch(batch: EventBatchRequest): Promise<EventBatchResponseWire> {
  const body = toEventBatchWire(batch.events, Platform.OS === 'android' ? 'android' : 'ios', Constants.expoConfig?.version ?? '0.0.0');
  if (!body) return { accepted: 0, rejected: [] };
  return apiRequest<EventBatchResponseWire>('v1/tenant/event', { method: 'POST', body });
}

/**
 * Analytics batches use their own scope: they queue and retry like every other write, but a slow or
 * failing batch never holds back the user's own writes.
 */
export function registerAnalyticsMutation(client: QueryClient): void {
  client.setMutationDefaults(analyticsMutationKey, {
    scope: { id: 'analytics' },
    mutationFn: sendEventBatch,
  });
}

/**
 * Connects `track()` to the signed-in user's persisted mutation queue and flushes when the app
 * goes to the background. Rendered inside the QueryProvider; does nothing while signed out.
 */
export function AnalyticsHost({ userId }: { userId: string | null }) {
  const client = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    bindAnalyticsSink((batch) => {
      void client
        .getMutationCache()
        .build(client, { mutationKey: analyticsMutationKey })
        .execute(batch)
        .catch(() => undefined); // Analytics never surfaces an error to the user.
    });
    const subscription = AppState.addEventListener('change', (status) => {
      if (status !== 'active') flushAnalytics();
    });
    return () => {
      subscription.remove();
      bindAnalyticsSink(null);
    };
  }, [client, userId]);

  return null;
}
