import type { Money } from '@/lib/format';

/**
 * Bildirim merkezi (`/notifications`, opened by the bell on 06 Bugün).
 *
 * ⚠ PROVISIONAL — there is no backend contract yet. Shapes are assumed from the notification types the
 * product already has (29 Ayarlar toggles, 24b price alerts, 25 friend ratings, 05 membership).
 * The server sends data only; every sentence is built in the app, per language.
 */

type Base = {
  id: string;
  /** UTC ISO-8601. */
  createdAt: string;
  /** null = unread. */
  readAt: string | null;
};

/** A watched product got cheaper (24b) → 22 Ürün. */
export type PriceDropNotification = Base & {
  kind: 'price_drop';
  productId: string;
  productName: string;
  brandName: string;
  price: Money;
  previousPrice: Money;
};
/** A friend rated one of the user's looks (25) → 25 Arkadaş akışı. */
export type FriendRatingNotification = Base & {
  kind: 'friend_rating';
  person: { handle: string; displayName: string };
  lookId: string;
  /** 1–5. */
  score: number;
};
/** The weekly plan was prepared (07) → 07 Haftalık plan. */
export type WeeklyPlanNotification = Base & { kind: 'weekly_plan'; weekStart: string };
/** Few AI image credits left this month → Üyelik. */
export type CreditsLowNotification = Base & { kind: 'credits_low'; remaining: number };
/** The membership renews soon → Üyelik. */
export type RenewalNotification = Base & { kind: 'renewal'; renewsAt: string };

export type AppNotification =
  | PriceDropNotification
  | FriendRatingNotification
  | WeeklyPlanNotification
  | CreditsLowNotification
  | RenewalNotification;

export type NotificationKind = AppNotification['kind'];

/** GET v1/tenant/notification — newest first. Assumption: the last 30 days in one page. */
export type NotificationList = { items: AppNotification[] };

/** PUT v1/tenant/notification/read — `ids: null` marks everything read. Idempotent on `clientMutationId`. */
export type MarkNotificationsReadRequest = { ids: string[] | null; clientMutationId: string };
