import type { AppNotification, MarkNotificationsReadRequest, NotificationList } from '@/api/contracts/notifications';
import { toIsoDate } from '@/lib/format';

import { storeFixtures } from './store';

/**
 * Typed fixtures for the notification centre. Times are relative to "now" so the list always has a
 * "today", a "yesterday" and an older group. The price-drop row is the watched product of the store
 * fixtures (24b), so the notification and the watchlist tell the same story.
 */

const HOUR = 3_600_000;

/** `daysAgo: 0` = today, `hoursAgo` before now (never before midnight); older days are placed at noon. */
type Seed = { daysAgo: number; hoursAgo?: number; read: boolean; build: (base: { id: string; createdAt: string; readAt: string | null }) => AppNotification | null };

const SEEDS: Seed[] = [
  {
    daysAgo: 0,
    hoursAgo: 1,
    read: false,
    build: (base) => {
      const drop = storeFixtures.watchlist().items.find((i) => i.price && i.previousPrice);
      if (!drop?.price || !drop.previousPrice) return null;
      return {
        ...base,
        kind: 'price_drop',
        productId: drop.productId,
        productName: drop.name,
        brandName: drop.brandName,
        price: drop.price,
        previousPrice: drop.previousPrice,
      };
    },
  },
  {
    daysAgo: 0,
    hoursAgo: 3,
    read: false,
    build: (base) => ({ ...base, kind: 'friend_rating', person: { handle: 'selin', displayName: 'Selin' }, lookId: 'look_office_1', score: 5 }),
  },
  {
    daysAgo: 1,
    read: false,
    build: (base) => ({ ...base, kind: 'weekly_plan', weekStart: toIsoDate(new Date()) }),
  },
  {
    daysAgo: 1,
    read: true,
    build: (base) => ({ ...base, kind: 'friend_rating', person: { handle: 'ayse', displayName: 'Ayşe' }, lookId: 'look_weekend_1', score: 4 }),
  },
  {
    daysAgo: 3,
    read: true,
    build: (base) => ({ ...base, kind: 'credits_low', remaining: 3 }),
  },
  {
    daysAgo: 4,
    read: true,
    build: (base) => ({ ...base, kind: 'renewal', renewsAt: new Date(Date.now() + 7 * 24 * HOUR).toISOString() }),
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
    if (state.empty) return { items: [] };
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
    return { items };
  },
  markRead: (request: MarkNotificationsReadRequest): void => {
    if (request.ids === null) state.allReadAt = Date.now();
    else request.ids.forEach((id) => state.read.add(id));
  },
};
