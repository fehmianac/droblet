/**
 * POST v1/tenant/event — batched analytics events (at most 50 per request).
 *
 * ⚠ PROVISIONAL body shape. Event names are the allow-list from BRIEF §6 (funnel + revenue events
 * reported to investors); `conversion` is recorded by the server from the affiliate postback and is
 * therefore not a client event.
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
  'cart_added',
  /** "[Marka]'da öde" — the brand site was opened. */
  'brand_checkout_opened',
  'look_shared',
  /** An invite code captured from a link was applied after sign-up. */
  'invite_install',
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

export type AnalyticsParams = Record<string, string | number | boolean | null>;

export type AnalyticsEvent = {
  /** ULID — the server de-duplicates on it. */
  id: string;
  name: AnalyticsEventName;
  /** Device time of the action, UTC ISO-8601. */
  occurredAt: string;
  params: AnalyticsParams;
};

export const MAX_EVENTS_PER_BATCH = 50;

export type EventBatchRequest = { clientMutationId: string; events: AnalyticsEvent[] };
