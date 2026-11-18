import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type { NotificationList } from '@/api/contracts/notifications';
import { fromSource } from '@/api/dataSource';
import { notificationFixtures } from '@/fixtures/notifications';

export const notificationKeys = {
  list: ['tenant', 'notification', 'list'] as const,
};

/** The notification centre: newest first; the cached list is what the offline state shows. */
export function useNotifications() {
  return useQuery({
    queryKey: notificationKeys.list,
    queryFn: () => fromSource('notifications', notificationFixtures.list, () => apiRequest<NotificationList>('v1/tenant/notification')),
  });
}
