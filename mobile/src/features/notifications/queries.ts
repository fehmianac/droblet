import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';

import { apiRequest } from '@/api/client';
import type { NotificationList } from '@/api/contracts/notifications';
import { fromSource } from '@/api/dataSource';
import { toNotificationList, type NotificationPageWire } from '@/api/wire/notifications';
import { notificationFixtures } from '@/fixtures/notifications';

import { appendPage } from './logic';

export const notificationKeys = {
  list: ['tenant', 'notification', 'list'] as const,
};

/** Rows per request (`limit`, server default 30, max 100). Further pages load as the list is scrolled. */
export const NOTIFICATION_PAGE_SIZE = 30;

function fetchPage(pageToken: string | null): Promise<NotificationList> {
  return fromSource<NotificationList>(
    'notifications',
    () => notificationFixtures.page(pageToken, NOTIFICATION_PAGE_SIZE),
    async () => {
      const token = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
      return toNotificationList(await apiRequest<NotificationPageWire>(`v1/tenant/notification?limit=${NOTIFICATION_PAGE_SIZE}${token}`));
    },
  );
}

/**
 * The notification centre (`GET v1/tenant/notification`): the first page, newest first. Older pages are appended to the
 * same cache entry by `useLoadMoreNotifications` (its `pageToken` is the next cursor), so "mark read" and the bell
 * badge keep working on one list. A refresh starts again from the first page.
 */
export function useNotifications() {
  return useQuery({
    queryKey: notificationKeys.list,
    queryFn: () => fetchPage(null),
  });
}

/**
 * Infinite scroll of the centre: `loadMore()` fetches the page after the cached cursor and appends it (ids already shown
 * are skipped, so rows that arrived meanwhile never repeat). One request at a time; `hasMore` is false on the last page.
 */
export function useLoadMoreNotifications() {
  const client = useQueryClient();
  const list = useNotifications().data;
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const pageToken = list?.pageToken ?? null;

  const loadMore = useCallback(async () => {
    if (inFlight.current || !pageToken) return;
    inFlight.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const page = await fetchPage(pageToken);
      client.setQueryData<NotificationList>(notificationKeys.list, (prev) => (prev && prev.pageToken === pageToken ? appendPage(prev, page) : prev));
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [client, pageToken]);

  return { loadMore, loading, failed, hasMore: pageToken !== null };
}

/** The unread badge on the bell (06 Bugün): the server's count, which covers every page. */
export function useUnreadNotificationCount(): number {
  return useNotifications().data?.unreadCount ?? 0;
}
