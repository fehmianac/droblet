/**
 * Small in-memory state of the store feature that has no server counterpart (yet). Nothing here is
 * persisted: it lasts for the app session.
 */

/** productId → job id of a try-on that is still running (`POST v1/tenant/tryon` answered 202). */
export const pendingProductTryOns = new Map<string, string>();

/**
 * Favourite products kept on the device while the backend in front of the app does not have the
 * favourites endpoints yet (`v1/tenant/favorite/product` answers 404 there).
 */
export const localFavorites = new Set<string>();
