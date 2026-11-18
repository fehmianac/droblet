/**
 * Where a tapped push notification opens (docs/api/store-social-settings.md §9: `data.type` + extra
 * keys). Pure, so whichever push SDK delivers the tap only calls `router.push(routeForPush(data))`.
 * Unknown types open Bugün.
 */
export type PushData = Record<string, string | undefined>;

export type PushRoute =
  | '/'
  | '/friends/requests'
  | '/watchlist'
  | '/wardrobe/looks'
  | { pathname: '/edit/[id]'; params: { id: string } }
  | { pathname: '/u/[handle]'; params: { handle: string } };

export function routeForPush(data: PushData | null | undefined): PushRoute {
  switch (data?.type) {
    case 'follow_request':
      return '/friends/requests';
    case 'price_drop':
      return '/watchlist';
    case 'weekly_edit':
      return data.editId ? { pathname: '/edit/[id]', params: { id: data.editId } } : '/';
    case 'friend_ratings':
      return '/wardrobe/looks';
    default:
      return '/';
  }
}
