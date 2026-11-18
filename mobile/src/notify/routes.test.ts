import { notificationRoute } from './routes';

describe('notification tap → screen', () => {
  it.each([
    [{ type: 'morning_outfit', day: '2026-11-19' }, '/'],
    [{ type: 'weekly_edit', editId: '01JCX3T7V0Q8M4ZK2R5N6P9W1B' }, '/edit/01JCX3T7V0Q8M4ZK2R5N6P9W1B'],
    [{ type: 'weekly_edit' }, '/discover'],
    [{ type: 'friend_rating', lookId: 'look-1' }, '/look/look-1'],
    [{ type: 'friend_ratings', day: '2026-11-19' }, '/friends/feed'],
    [{ type: 'follow_request' }, '/friends/find?tab=requests'],
    [{ type: 'price_drop', productId: 'p-42' }, '/shop/product/p-42'],
    [{ type: 'price_drop' }, '/watchlist'],
  ])('%j → %s', (data, route) => {
    expect(notificationRoute(data)).toBe(route);
  });

  it('ignores unknown types and unsafe ids', () => {
    expect(notificationRoute({ type: 'something_new' })).toBeNull();
    expect(notificationRoute(null)).toBeNull();
    expect(notificationRoute({ type: 'price_drop', productId: '../../etc' })).toBe('/watchlist');
  });
});
