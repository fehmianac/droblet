import { useMutation, type QueryClient } from '@tanstack/react-query';

import type { MarkNotificationsReadRequest, NotificationList } from '@/api/contracts/notifications';
import { fromSource } from '@/api/dataSource';
import { notificationFixtures } from '@/fixtures/notifications';
import { newClientMutation } from '@/sync/clientMutation';
import { TENANT_WRITE_SCOPE } from '@/sync/queryKeys';

import { markRead } from './logic';
import { notificationKeys } from './queries';

export const notificationMutationKeys = {
  markRead: ['tenant', 'notification', 'read'] as const,
};

/** Registers the queued "mark read" write + its optimistic update (see `sync/featureMutations`). */
export function registerNotificationMutations(client: QueryClient): void {
  client.setMutationDefaults(notificationMutationKeys.markRead, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: MarkNotificationsReadRequest) =>
      fromSource(
        'notifications',
        () => notificationFixtures.markRead(vars),
        // Provisional `PUT v1/tenant/notification/read` does not exist yet: nothing to send.
        () => Promise.resolve(),
      ),
    onMutate: async (vars: MarkNotificationsReadRequest) => {
      await client.cancelQueries({ queryKey: notificationKeys.list });
      client.setQueryData<NotificationList>(notificationKeys.list, (prev) => markRead(prev, vars.ids, new Date().toISOString()));
    },
    onError: () => void client.invalidateQueries({ queryKey: notificationKeys.list }),
  });
}

/** Marks the given notifications read; `null` = "Tümünü okundu say". Optimistic and queued while offline. */
export function useMarkNotificationsRead() {
  const m = useMutation<void, unknown, MarkNotificationsReadRequest>({ mutationKey: notificationMutationKeys.markRead });
  return (ids: string[] | null) => m.mutate({ ids, clientMutationId: newClientMutation().clientMutationId });
}
