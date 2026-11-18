/**
 * Analytics events as the APP tracks them (`track(name, params)`). They are sent in batches to
 * `POST v1/tenant/event`; the wire body, the server's own event names and the prop allow-list are in
 * `../wire/analytics.ts`, which converts each batch when it is sent.
 *
 * Some of these names are recorded by the SERVER itself (`cart_added`, `brand_checkout_opened`,
 * `look_shared`, `invite_install`, and `conversion` from the affiliate postback): the app may still
 * call `track()` for them, but they are never put on the wire.
 */
export const ANALYTICS_EVENTS = [
  /** Onboarding funnel; `step`: welcome | account_created | style_profile | body_profile | first_items | done. */
  'signup_step',
  'first_item_added',
  'first_look_created',
  'paywall_viewed',
  'subscribed',
  'credit_spent',
  'credits_exhausted',
  'complete_look_clicked',
  /** Server-recorded (cart line added) — not sent. */
  'cart_added',
  /** "[Marka]'da öde" — server-recorded at checkout, not sent. */
  'brand_checkout_opened',
  /** Server-recorded by `POST v1/tenant/share` — not sent. */
  'look_shared',
  /** Server-recorded by the invite attribution — not sent. */
  'invite_install',
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

export type AnalyticsParams = Record<string, string | number | boolean | null>;

export type AnalyticsEvent = {
  /** ULID — identifies the event on the device (the wire has no event id). */
  id: string;
  name: AnalyticsEventName;
  /** Device time of the action, UTC ISO-8601 (accepted from 7 days back to 10 minutes ahead). */
  occurredAt: string;
  params: AnalyticsParams;
};

export const MAX_EVENTS_PER_BATCH = 50;

/** One queued batch of app events (`clientMutationId` identifies the queued write on the device). */
export type EventBatchRequest = { clientMutationId: string; events: AnalyticsEvent[] };
