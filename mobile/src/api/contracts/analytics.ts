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
  // ---- App-only events (docs/analytics-events.md). The server's allow-list does not take them, so the
  // first-party wire drops them (`toEventWire`); they reach Firebase Analytics only, when it is switched on.
  /** Returning sign-in; `method`: email | apple | google. (A new account is `signup_step` account_created.) */
  'login',
  /** "Üzerimde gör" accepted by the server; `path` body | face, `cached`, `creditCost`, `target`. */
  'tryon_start',
  'tryon_complete',
  'tryon_failed',
  /** A stylist job delivered suggestions; `source` stylist | complete. */
  'outfit_suggested',
  /** "Haftamı planla" delivered a week proposal. */
  'week_planned',
  /** The trip packing job delivered a list. */
  'trip_packed',
  /** Pieces saved to the wardrobe; `source` photo | manual | library | bulk | import, `count`. */
  'item_added',
  /** Outfit-photo import confirmed; `looks`, `items` counts. */
  'outfit_import_commit',
  /** A look saved; `source` editor | stylist. */
  'look_saved',
  /** A suggestion put on the calendar; `source` stylist. */
  'calendar_added',
  /** The 05b extra-credit sheet opened; `reason`. */
  'credit_pack_view',
  /** A privacy choice changed; `type` (consent type or product_analytics), `granted`. */
  'consent_updated',
  /** Store purchase confirmed by the server; `productId`, `kind` subscription | credit_pack. */
  'purchase',
  /** Store purchase sheet opened; `productId`, `kind`. */
  'begin_checkout',
  /** Catalogue product detail opened; `productId`, `brandId`. */
  'view_item',
  /** A search ran; `surface` (never the typed text). */
  'search',
  /** A piece of content was picked; `contentType`, `source`. */
  'select_content',
  /** Canvas 19 · notification permission: `action` shown | allow | decline | result, `granted` (result), `source` onboarding | app_start, `variant` adult | teen. */
  'push_permission',
  /** Akış F1: a post scrolled into view, once per post per app session; `postId`, `authorKind` edit | stylist. */
  'feed_post_view',
  /** Akış: a post's detail opened from its card (photograph or title); `postId`, `kind` editor | user. */
  'feed_post_open',
  /** Akış F1: ♡ toggled; `postId`, `liked`. */
  'feed_like',
  /** Akış F1: "Kaydet" toggled; `postId`, `saved`. */
  'feed_save',
  /** Akış: "Looklarıma ekle" — the server made the look; `postId`, `mode` inspiration | pieces. */
  'feed_save_as_look',
  /** Akış F1: an editor story opened in the viewer; `storyId`. */
  'feed_story_view',
  /** Akış F1: a product opened on the brand site; `productId`, `brandId`, `source` post | story, `postId`. */
  'feed_buy_click',
  /** Akış F1: "Üzerimde dene · 1 kredi" tapped; `source` post | story, `postId` (post) or `productId` (story). */
  'feed_tryon_start',
  /** Akış F2: "Akışta paylaş" switched on for a look; `lookId`, `first` (the confirmation sheet was shown). */
  'feed_share_on',
  /** Akış F2: "Akışta paylaş" switched off; `lookId`. */
  'feed_share_off',
  /** Akış F2: "Bunu gösterme" on a member's post; `postId`. */
  'feed_hide',
  /** Akış F2: a member's post reported; `postId`, `reason`. */
  'feed_report',
  /** Akış F2: "Benzerlerini gör" opened; `postId`. */
  'feed_similar_open',
  /** Akış: "Kendi parçalarımla kur" on an editor post; `postId`, `count` (matching wardrobe pieces). */
  'feed_build_with_mine',
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
