import type { AppNotification } from '@/api/contracts/notifications';
import { notificationFixtures, resetNotificationFixtures } from '@/fixtures/notifications';
import { resetStoreFixtures } from '@/fixtures/store';

import { groupByDay, markRead, targetOf, unreadCount } from './logic';

const at = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h).toISOString();
const plan = (id: string, createdAt: string, readAt: string | null = null): AppNotification => ({
  id,
  kind: 'weekly_plan',
  weekStart: '2026-11-16',
  createdAt,
  readAt,
});

describe('notification grouping', () => {
  const now = new Date(2026, 10, 18, 14, 0);

  it('groups by local day, newest first, and names today and yesterday', () => {
    const groups = groupByDay(
      [plan('old', at(2026, 11, 14, 9)), plan('y', at(2026, 11, 17, 23)), plan('t1', at(2026, 11, 18, 8)), plan('t2', at(2026, 11, 18, 13))],
      now,
    );
    expect(groups.map((g) => [g.bucket, g.day, g.items.map((n) => n.id)])).toEqual([
      ['today', '2026-11-18', ['t2', 't1']],
      ['yesterday', '2026-11-17', ['y']],
      ['earlier', '2026-11-14', ['old']],
    ]);
  });

  it('returns no groups for an empty list', () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});

describe('read state', () => {
  const list = { items: [plan('a', at(2026, 11, 18, 8)), plan('b', at(2026, 11, 18, 9)), plan('c', at(2026, 11, 17, 9), 'earlier')] };

  it('counts unread notifications', () => {
    expect(unreadCount(list.items)).toBe(2);
  });

  it('marks the given ids read and leaves the rest', () => {
    const next = markRead(list, ['a'], 'now');
    expect(next?.items.map((n) => n.readAt)).toEqual(['now', null, 'earlier']);
  });

  it('marks everything read with null and keeps earlier read times', () => {
    const next = markRead(list, null, 'now');
    expect(next?.items.map((n) => n.readAt)).toEqual(['now', 'now', 'earlier']);
    expect(markRead(undefined, null, 'now')).toBeUndefined();
  });
});

describe('notification targets and fixtures', () => {
  beforeEach(() => {
    resetStoreFixtures();
    resetNotificationFixtures();
  });

  it('sends each kind to its subject', () => {
    const targets = Object.fromEntries(notificationFixtures.list().items.map((n) => [n.kind, targetOf(n)]));
    expect(targets).toEqual({
      price_drop: { pathname: '/shop/product/[id]', params: { id: 'prod_003' } },
      friend_rating: '/friends/feed',
      weekly_plan: '/plan/week',
      credits_low: '/subscription',
      renewal: '/subscription',
    });
  });

  it('the fixture list has today, yesterday and earlier, and remembers what was read', () => {
    const before = notificationFixtures.list().items;
    expect(new Set(groupByDay(before).map((g) => g.bucket))).toEqual(new Set(['today', 'yesterday', 'earlier']));
    expect(unreadCount(before)).toBe(3);
    notificationFixtures.markRead({ ids: ['notif_1'], clientMutationId: 'm1' });
    expect(unreadCount(notificationFixtures.list().items)).toBe(2);
    notificationFixtures.markRead({ ids: null, clientMutationId: 'm2' });
    expect(unreadCount(notificationFixtures.list().items)).toBe(0);
    resetNotificationFixtures({ empty: true });
    expect(notificationFixtures.list().items).toEqual([]);
  });
});
