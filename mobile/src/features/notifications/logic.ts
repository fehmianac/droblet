import { NOTIFICATION_TYPES, type AppNotification, type NotificationKind, type NotificationList } from '@/api/contracts/notifications';
import { routeForPush, type PushRoute } from '@/notify/routes';

export type DayBucket = 'today' | 'yesterday' | 'earlier';

export type NotificationGroup = {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
  bucket: DayBucket;
  /** Midnight of that local day — for the date label of older groups. */
  date: Date;
  items: AppNotification[];
};

const pad = (n: number) => String(n).padStart(2, '0');
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Newest first, grouped by the device's local calendar day ("Bugün", "Dün", then the date). */
export function groupByDay(items: AppNotification[], now: Date = new Date()): NotificationGroup[] {
  const today = startOfDay(now).getTime();
  const yesterday = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)).getTime();
  const groups = new Map<string, NotificationGroup>();
  const sorted = [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  for (const item of sorted) {
    const date = startOfDay(new Date(item.createdAt));
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const time = date.getTime();
    const group = groups.get(day) ?? {
      day,
      date,
      bucket: time >= today ? 'today' : time === yesterday ? 'yesterday' : 'earlier',
      items: [],
    };
    group.items.push(item);
    groups.set(day, group);
  }
  return [...groups.values()];
}

export function unreadCount(items: AppNotification[]): number {
  return items.filter((n) => n.readAt === null).length;
}

/** The list as it looks once `ids` (or everything, with `null`) is read — the optimistic value of "mark read". */
export function markRead(list: NotificationList | undefined, ids: string[] | null, at: string): NotificationList | undefined {
  if (!list) return list;
  let newlyRead = 0;
  const items = list.items.map((n) => {
    if (n.readAt !== null || (ids !== null && !ids.includes(n.id))) return n;
    newlyRead += 1;
    return { ...n, readAt: at };
  });
  // Everything read: nothing is unread on later pages either.
  const unreadCount = ids === null ? 0 : Math.max(0, list.unreadCount - newlyRead);
  return { ...list, items, unreadCount };
}

/**
 * The next page appended to the loaded list: rows already shown are skipped (a row that arrived between two requests
 * never appears twice), the cursor moves on, and the server's unread count (it covers every page) is taken.
 */
export function appendPage(list: NotificationList, page: NotificationList): NotificationList {
  const seen = new Set(list.items.map((n) => n.id));
  return {
    items: [...list.items, ...page.items.filter((n) => !seen.has(n.id))],
    pageToken: page.pageToken,
    unreadCount: page.unreadCount,
  };
}

/** True when the scroll position is within `threshold` points of the end (load the next page). */
export function nearEnd(e: { layoutMeasurement: { height: number }; contentOffset: { y: number }; contentSize: { height: number } }, threshold = 400): boolean {
  return e.layoutMeasurement.height + e.contentOffset.y >= e.contentSize.height - threshold;
}

export type NotificationTarget = PushRoute;

/** Where a notification takes the user — the same place its push opens (`notify/routes`). */
export function targetOf(notification: AppNotification): NotificationTarget {
  if (notification.kind === 'morning_outfit') return '/';
  return routeForPush({ type: notification.kind, ...notification.data });
}

export const NOTIFICATION_KINDS: readonly NotificationKind[] = NOTIFICATION_TYPES;
