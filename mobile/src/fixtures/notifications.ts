import type { AppNotification, MarkNotificationsReadRequest, NotificationList } from '@/api/contracts/notifications';
import { toIsoDate } from '@/lib/format';

import { storeFixtures } from './store';

/**
 * Typed fixtures for the notification centre. Times are relative to "now" so the list always has a
 * "today", a "yesterday" and an older group. The price-drop row is the watched product of the store
 * fixtures (24b), so the notification and the watchlist tell the same story.
 */

const HOUR = 3_600_000;

type Base = { id: string; createdAt: string; readAt: string | null };

/** `daysAgo: 0` = today, `hoursAgo` before now (never before midnight); older days are placed at noon. */
type Seed = { daysAgo: number; hoursAgo?: number; read: boolean; build: (base: Base) => AppNotification | null };

const SEEDS: Seed[] = [
  {
    daysAgo: 0,
    hoursAgo: 1,
    read: false,
    build: (base) => {
      const drop = storeFixtures.watchlist().items.find((i) => i.price && i.previousPrice);
      return drop ? { ...base, kind: 'price_drop', data: { productId: drop.productId } } : null;
    },
  },
  {
    daysAgo: 0,
    hoursAgo: 3,
    read: false,
    build: (base) => ({ ...base, kind: 'follow_request', data: { handle: 'selin' } }),
  },
  {
    daysAgo: 1,
    read: false,
    build: (base) => ({ ...base, kind: 'morning_outfit', data: { day: toIsoDate(new Date(Date.now() - 24 * HOUR)) } }),
  },
  {
    daysAgo: 1,
    read: true,
    build: (base) => ({ ...base, kind: 'friend_ratings', data: { day: toIsoDate(new Date(Date.now() - 24 * HOUR)) } }),
  },
  {
    daysAgo: 3,
    read: true,
    build: (base) => ({ ...base, kind: 'weekly_edit', data: { editId: 'edit_current' } }),
  },
];

type State = { empty: boolean; read: Set<string>; allReadAt: number | null };

let state: State = { empty: false, read: new Set(), allReadAt: null };

/** Test helper: back to the seeded list (or to an account without notifications). */
export function resetNotificationFixtures(overrides: { empty?: boolean } = {}): void {
  state = { empty: overrides.empty ?? false, read: new Set(), allReadAt: null };
}

export const notificationFixtures = {
  list: (): NotificationList => {
    if (state.empty) return { items: [], pageToken: null, unreadCount: 0 };
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const items = SEEDS.map((seed, index) => {
      const id = `notif_${index + 1}`;
      const time =
        seed.daysAgo === 0
          ? Math.max(midnight, now.getTime() - (seed.hoursAgo ?? 0) * HOUR)
          : new Date(now.getFullYear(), now.getMonth(), now.getDate() - seed.daysAgo, 12 - index).getTime();
      const createdAt = new Date(time).toISOString();
      const read = seed.read || state.read.has(id) || state.allReadAt !== null;
      return seed.build({ id, createdAt, readAt: read ? createdAt : null });
    }).filter((n): n is AppNotification => n !== null);
    return { items, pageToken: null, unreadCount: items.filter((n) => n.readAt === null).length };
  },
  markRead: (request: MarkNotificationsReadRequest): void => {
    if (request.ids === null) state.allReadAt = Date.now();
    else request.ids.forEach((id) => state.read.add(id));
  },
};
