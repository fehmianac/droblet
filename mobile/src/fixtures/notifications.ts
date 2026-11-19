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

type State = { empty: boolean; read: Set<string>; allReadAt: number | null; older: number };

let state: State = { empty: false, read: new Set(), allReadAt: null, older: 0 };

/**
 * Test helper: back to the seeded list (or to an account without notifications). `older` adds that many read weekly-edit
 * rows before the seeds (10+ days ago), so the inbox spans several pages.
 */
export function resetNotificationFixtures(overrides: { empty?: boolean; older?: number } = {}): void {
  state = { empty: overrides.empty ?? false, read: new Set(), allReadAt: null, older: overrides.older ?? 0 };
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
    for (let i = 0; i < state.older; i += 1) {
      const createdAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 10 - Math.floor(i / 4), 18 - (i % 4)).toISOString();
      items.push({ id: `notif_old_${i + 1}`, kind: 'weekly_edit', createdAt, readAt: createdAt, data: { editId: 'edit_current' } });
    }
    return { items, pageToken: null, unreadCount: items.filter((n) => n.readAt === null).length };
  },
  /** One page of the inbox, newest first; the token is the offset (the server's is an opaque cursor). */
  page: (pageToken: string | null, limit: number): NotificationList => {
    const all = notificationFixtures.list();
    const offset = pageToken ? Number(pageToken) : 0;
    const items = all.items.slice(offset, offset + limit);
    const next = offset + limit < all.items.length ? String(offset + limit) : null;
    return { items, pageToken: next, unreadCount: all.unreadCount };
  },
  markRead: (request: MarkNotificationsReadRequest): void => {
    if (request.ids === null) state.allReadAt = Date.now();
    else request.ids.forEach((id) => state.read.add(id));
  },
};
