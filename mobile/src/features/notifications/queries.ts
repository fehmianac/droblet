import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type { NotificationList } from '@/api/contracts/notifications';
import { fromSource } from '@/api/dataSource';
import { toNotificationList, type NotificationPageWire } from '@/api/wire/notifications';
import { notificationFixtures } from '@/fixtures/notifications';

export const notificationKeys = {
  list: ['tenant', 'notification', 'list'] as const,
};

/** One page is what the centre shows: 90 days of events, newest first (the server keeps no more). */
export const NOTIFICATION_PAGE_SIZE = 100;

/** The notification centre (`GET v1/tenant/notification`): newest first; the cached list is what the offline state shows. */
export function useNotifications() {
  return useQuery({
    queryKey: notificationKeys.list,
    queryFn: () =>
      fromSource<NotificationList>('notifications', notificationFixtures.list, async () =>
        toNotificationList(await apiRequest<NotificationPageWire>(`v1/tenant/notification?limit=${NOTIFICATION_PAGE_SIZE}`)),
      ),
  });
}

/** The unread badge on the bell (06 Bugün): the server's count, which covers every page. */
export function useUnreadNotificationCount(): number {
  return useNotifications().data?.unreadCount ?? 0;
}
