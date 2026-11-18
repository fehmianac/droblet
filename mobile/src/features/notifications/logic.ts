import type { AppNotification, NotificationKind, NotificationList } from '@/api/contracts/notifications';

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
  return {
    ...list,
    items: list.items.map((n) => (n.readAt === null && (ids === null || ids.includes(n.id)) ? { ...n, readAt: at } : n)),
  };
}

export type NotificationTarget =
  | { pathname: '/shop/product/[id]'; params: { id: string } }
  | '/friends/feed'
  | '/plan/week'
  | '/subscription';

/** Where a notification takes the user: product (22), friend feed (25), weekly plan (07) or membership. */
export function targetOf(notification: AppNotification): NotificationTarget {
  switch (notification.kind) {
    case 'price_drop':
      return { pathname: '/shop/product/[id]', params: { id: notification.productId } };
    case 'friend_rating':
      return '/friends/feed';
    case 'weekly_plan':
      return '/plan/week';
    case 'credits_low':
    case 'renewal':
      return '/subscription';
  }
}

export const NOTIFICATION_KINDS: NotificationKind[] = ['price_drop', 'friend_rating', 'weekly_plan', 'credits_low', 'renewal'];
