import { NOTIFICATION_TYPES, type AppNotification, type NotificationKind, type NotificationList } from '../contracts/notifications';

/** Wire shapes of the notification inbox (docs/api/store-social-settings.md, `src/Api/Endpoints/V1/Tenant/Notification`). */
export type NotificationWire = {
  id: string;
  type: string;
  createdAt: string;
  readAt: string | null;
  data?: Record<string, string> | null;
};

export type NotificationPageWire = { items: NotificationWire[]; pageToken: string | null; unreadCount: number };

export type MarkReadWire = { ids: string[] | null };
export type MarkReadResponseWire = { unreadCount: number };

const KNOWN = NOTIFICATION_TYPES as readonly string[];

/** Unknown types (a newer server) are dropped: the app cannot phrase them. */
export function toNotification(wire: NotificationWire): AppNotification | null {
  if (!KNOWN.includes(wire.type)) return null;
  const data = wire.data ?? {};
  return {
    id: wire.id,
    kind: wire.type as NotificationKind,
    createdAt: wire.createdAt,
    readAt: wire.readAt,
    data: {
      ...(data.day ? { day: data.day } : {}),
      ...(data.editId ? { editId: data.editId } : {}),
      ...(data.productId ? { productId: data.productId } : {}),
      ...(data.handle ? { handle: data.handle } : {}),
      ...(data.exportId ? { exportId: data.exportId } : {}),
    },
  };
}

export function toNotificationList(wire: NotificationPageWire): NotificationList {
  return {
    items: wire.items.map(toNotification).filter((n): n is AppNotification => n !== null),
    pageToken: wire.pageToken,
    unreadCount: wire.unreadCount,
  };
}
