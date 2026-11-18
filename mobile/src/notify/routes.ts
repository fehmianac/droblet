/**
 * Where a tapped push notification opens (docs/api/store-social-settings.md §9 and purchases-push.md §5:
 * `data.type` + extra keys, all strings). Pure; `DeviceHost` calls `router.push(routeForPush(data))`.
 *
 *   morning_outfit             → 06 Bugün
 *   weekly_edit {editId}       → 08 Haftanın edit'i
 *   friend_rating(s) {lookId}  → the rated look; without an id the user's looks
 *   follow_request             → follow requests
 *   price_drop {productId}     → 22 Ürün; without an id the watch list
 * Unknown types or unusable ids open Bugün.
 */
export type PushData = Record<string, unknown>;

export type PushRoute =
  | '/'
  | '/friends/requests'
  | '/watchlist'
  | '/wardrobe/looks'
  | { pathname: '/edit/[id]'; params: { id: string } }
  | { pathname: '/look/[id]'; params: { id: string } }
  | { pathname: '/shop/product/[id]'; params: { id: string } }
  | { pathname: '/u/[handle]'; params: { handle: string } };

const ID = /^[A-Za-z0-9_.-]{1,128}$/;

function id(data: PushData, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' && ID.test(value) && !value.includes('..') ? value : null;
}

export function routeForPush(data: PushData | null | undefined): PushRoute {
  if (!data) return '/';
  switch (data.type) {
    case 'follow_request':
      return '/friends/requests';
    case 'price_drop': {
      const productId = id(data, 'productId');
      return productId ? { pathname: '/shop/product/[id]', params: { id: productId } } : '/watchlist';
    }
    case 'weekly_edit': {
      const editId = id(data, 'editId');
      return editId ? { pathname: '/edit/[id]', params: { id: editId } } : '/';
    }
    case 'friend_rating':
    case 'friend_ratings': {
      const lookId = id(data, 'lookId');
      return lookId ? { pathname: '/look/[id]', params: { id: lookId } } : '/wardrobe/looks';
    }
    default:
      return '/';
  }
}
