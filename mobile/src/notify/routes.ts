/**
 * Push notification data → the screen a tap opens (docs/api/purchases-push.md §5). Pure. The server
 * sends codes, never sentences; `type` decides the route, ids ride along as strings.
 *
 *   morning_outfit            → 06 Bugün
 *   weekly_edit {editId}      → 08 Haftanın edit'i
 *   friend_rating(s) {lookId} → the look (25 feed opened on it); without an id the friends feed
 *   follow_request            → follow requests (27 Dolapları keşfet, where requests are listed)
 *   price_drop {productId}    → 22 Ürün
 * Anything unknown opens the app where it was (null).
 */
export type NotificationData = Record<string, unknown> | null | undefined;

const ID = /^[A-Za-z0-9_-]{1,128}$/;

function id(data: NotificationData, key: string): string | null {
  const value = data?.[key];
  return typeof value === 'string' && ID.test(value) ? value : null;
}

export function notificationRoute(data: NotificationData): string | null {
  switch (typeof data?.type === 'string' ? data.type : null) {
    case 'morning_outfit':
      return '/';
    case 'weekly_edit': {
      const editId = id(data, 'editId');
      return editId ? `/edit/${editId}` : '/discover';
    }
    case 'friend_rating':
    case 'friend_ratings': {
      const lookId = id(data, 'lookId');
      return lookId ? `/look/${lookId}` : '/friends/feed';
    }
    case 'follow_request':
      return '/friends/find?tab=requests';
    case 'price_drop': {
      const productId = id(data, 'productId');
      return productId ? `/shop/product/${productId}` : '/watchlist';
    }
    default:
      return null;
  }
}
