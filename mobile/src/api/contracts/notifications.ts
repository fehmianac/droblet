/**
 * Bildirim merkezi (`/notifications`, the bell on 06 Bugün) — `GET v1/tenant/notification` and
 * `POST v1/tenant/notification/read`. The inbox holds the same events the Notifier pushes (follow
 * requests, ratings summary, price drops, weekly edit, morning outfit), newest first, kept 90 days.
 * The server sends codes and ids only; every sentence is built in the app, per language.
 */

export const NOTIFICATION_TYPES = ['morning_outfit', 'weekly_edit', 'friend_ratings', 'price_drop', 'follow_request'] as const;
export type NotificationKind = (typeof NOTIFICATION_TYPES)[number];

/** The ids the event carries (the same keys as the push `data`). */
export type NotificationData = {
  /** `yyyy-MM-dd` — morning outfit / ratings day. */
  day?: string;
  editId?: string;
  productId?: string;
  /** Requester of a follow request (without @). */
  handle?: string;
};

export type AppNotification = {
  id: string;
  kind: NotificationKind;
  /** UTC ISO-8601. */
  createdAt: string;
  /** null = unread. */
  readAt: string | null;
  data: NotificationData;
};

/** GET v1/tenant/notification?pageToken=&limit= (default 30, max 100). */
export type NotificationList = { items: AppNotification[]; pageToken: string | null; unreadCount: number };

/** POST v1/tenant/notification/read `{ ids }` — `null` marks everything read → `{ unreadCount }`. Idempotent. */
export type MarkNotificationsReadRequest = { ids: string[] | null; clientMutationId: string };
