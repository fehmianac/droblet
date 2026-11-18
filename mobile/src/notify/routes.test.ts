import { routeForPush } from './routes';

describe('push notification routing', () => {
  it('opens the screen that belongs to each notification type', () => {
    expect(routeForPush({ type: 'follow_request', handle: 'elif' })).toBe('/friends/requests');
    expect(routeForPush({ type: 'price_drop', productId: 'prod_1' })).toBe('/watchlist');
    expect(routeForPush({ type: 'weekly_edit', editId: 'edit-1' })).toEqual({ pathname: '/edit/[id]', params: { id: 'edit-1' } });
    expect(routeForPush({ type: 'friend_ratings', day: '2026-11-18' })).toBe('/wardrobe/looks');
    expect(routeForPush({ type: 'morning_outfit', day: '2026-11-18' })).toBe('/');
  });

  it('falls back to Bugün for unknown or missing data', () => {
    expect(routeForPush({ type: 'something_new' })).toBe('/');
    expect(routeForPush({ type: 'weekly_edit' })).toBe('/');
    expect(routeForPush(null)).toBe('/');
  });
});
