import type { AnalyticsEventName, AnalyticsParams } from '@/api/contracts/analytics';

/**
 * The app's event vocabulary → Google Analytics 4 (Firebase) events. The full table, with when each
 * event fires, is `docs/analytics-events.md` — keep the two in step.
 *
 * Privacy rules enforced here, whatever a caller passes:
 * - only the parameters listed for an event are sent (renamed to GA4 names); everything else is dropped;
 * - a string value must look like an identifier (`SAFE_VALUE`: no spaces, no `@`, no `/`), so free text,
 *   e-mail addresses, names and URLs never leave the device;
 * - numbers must be finite; booleans travel as "true" / "false".
 */
export type FirebaseParams = Record<string, string | number>;
export type FirebaseEvent = { name: string; params: FirebaseParams };

/** Identifier-like values only (GA4 caps parameter values at 100 characters). */
export const SAFE_VALUE = /^[A-Za-z0-9._:-]{1,100}$/;

/** GA4: event names ≤ 40 chars, ≤ 25 params per event, param names ≤ 40 chars. */
export const MAX_EVENT_NAME = 40;
export const MAX_PARAMS = 25;
export const MAX_PARAM_NAME = 40;

/** Names Google reserves for automatically collected events (they cannot be logged). */
export const RESERVED_EVENT_NAMES = [
  'ad_activeview',
  'ad_click',
  'ad_exposure',
  'ad_impression',
  'ad_query',
  'ad_reward',
  'adunit_exposure',
  'app_background',
  'app_clear_data',
  'app_exception',
  'app_remove',
  'app_store_refund',
  'app_store_subscription_cancel',
  'app_store_subscription_convert',
  'app_store_subscription_renew',
  'app_update',
  'app_upgrade',
  'dynamic_link_app_open',
  'dynamic_link_app_update',
  'dynamic_link_first_open',
  'error',
  'first_open',
  'first_visit',
  'in_app_purchase',
  'notification_dismiss',
  'notification_foreground',
  'notification_open',
  'notification_receive',
  'os_update',
  'screen_view',
  'session_start',
  'user_engagement',
] as const;
/** Prefixes Google reserves for event, parameter and user-property names. */
export const RESERVED_PREFIXES = ['firebase_', 'google_', 'ga_'] as const;

type Rule = {
  /** GA4 event name. */
  name: string;
  /** App param → GA4 param. Unlisted params are never sent. */
  params?: Record<string, string>;
  /** Fixed GA4 params added to every event of this kind. */
  fixed?: FirebaseParams;
};

const ONBOARDING_STEP_PARAMS = { step: 'step', count: 'count', skipped: 'skipped', bodyPhotos: 'body_photos', facePhoto: 'face_photo' };

/** `signup_step` is one app event for the whole funnel; GA4 gets the recommended events where they exist. */
function signupRule(params: AnalyticsParams): Rule {
  switch (params.step) {
    case 'welcome':
      return { name: 'tutorial_begin' };
    case 'account_created':
      return { name: 'sign_up', params: { method: 'method' } };
    case 'done':
      return { name: 'tutorial_complete' };
    default:
      return { name: 'onboarding_step', params: ONBOARDING_STEP_PARAMS };
  }
}

/** One rule per app event; `null` = not sent to Firebase (its GA4 counterpart comes from another event). */
export const FIREBASE_RULES: Record<Exclude<AnalyticsEventName, 'signup_step'>, Rule | null> = {
  first_item_added: { name: 'first_item_added', params: { source: 'source' } },
  first_look_created: { name: 'first_look_created', params: { source: 'source' } },
  paywall_viewed: { name: 'paywall_view', params: { from: 'source' } },
  // The confirmed store purchase is logged as `purchase` by the purchase flow (subscriptions and credit packs alike).
  subscribed: null,
  credit_spent: { name: 'credit_spent', params: { feature: 'feature', count: 'count' } },
  credits_exhausted: { name: 'credits_exhausted', params: { feature: 'feature' } },
  complete_look_clicked: { name: 'select_content', params: { source: 'source' }, fixed: { content_type: 'complete_look' } },
  cart_added: { name: 'add_to_cart', params: { productId: 'item_id', brandId: 'item_brand', source: 'source' } },
  brand_checkout_opened: { name: 'begin_checkout', params: { brandId: 'item_brand', lineCount: 'count' }, fixed: { checkout: 'brand_site' } },
  look_shared: { name: 'share', params: { channel: 'method', kind: 'content_type' } },
  invite_install: { name: 'invite_install', params: { via: 'method' } },
  login: { name: 'login', params: { method: 'method' } },
  tryon_start: { name: 'tryon_start', params: { path: 'path', cached: 'cached', creditCost: 'credit_cost', target: 'target', count: 'count' } },
  tryon_complete: { name: 'tryon_complete', params: { path: 'path', cached: 'cached', creditCost: 'credit_cost', target: 'target' } },
  tryon_failed: { name: 'tryon_failed', params: { path: 'path', errorCode: 'error_code', creditRefunded: 'credit_refunded', target: 'target' } },
  outfit_suggested: { name: 'outfit_suggested', params: { source: 'source', count: 'count' } },
  week_planned: { name: 'week_planned', params: { count: 'count' } },
  trip_packed: { name: 'trip_packed', params: { count: 'count' } },
  item_added: { name: 'item_added', params: { source: 'source', count: 'count' } },
  outfit_import_commit: { name: 'outfit_import_commit', params: { looks: 'looks', items: 'items' } },
  look_saved: { name: 'look_saved', params: { source: 'source' } },
  calendar_added: { name: 'calendar_added', params: { source: 'source' } },
  credit_pack_view: { name: 'credit_pack_view', params: { reason: 'reason' } },
  consent_updated: { name: 'consent_updated', params: { type: 'consent_type', granted: 'granted', source: 'source' } },
  purchase: { name: 'purchase', params: { productId: 'item_id', kind: 'item_category', transactionId: 'transaction_id' } },
  begin_checkout: { name: 'begin_checkout', params: { productId: 'item_id', kind: 'item_category' }, fixed: { checkout: 'store' } },
  view_item: { name: 'view_item', params: { productId: 'item_id', brandId: 'item_brand' } },
  search: { name: 'search', params: { surface: 'surface', filtered: 'filtered' } },
  select_content: { name: 'select_content', params: { contentType: 'content_type', source: 'source' } },
  push_permission: { name: 'push_permission', params: { action: 'action', granted: 'granted', source: 'source', variant: 'variant' } },
  feed_post_view: { name: 'feed_post_view', params: { postId: 'post_id', authorKind: 'author_kind' } },
  feed_like: { name: 'feed_like', params: { postId: 'post_id', liked: 'liked' } },
  feed_save: { name: 'feed_save', params: { postId: 'post_id', saved: 'saved' } },
  feed_story_view: { name: 'feed_story_view', params: { storyId: 'story_id' } },
  feed_buy_click: { name: 'feed_buy_click', params: { productId: 'item_id', brandId: 'item_brand', source: 'source', postId: 'post_id' } },
  feed_tryon_start: { name: 'feed_tryon_start', params: { source: 'source', postId: 'post_id', productId: 'item_id' } },
  feed_share_on: { name: 'feed_share_on', params: { lookId: 'look_id', first: 'first' } },
  feed_share_off: { name: 'feed_share_off', params: { lookId: 'look_id' } },
  feed_hide: { name: 'feed_hide', params: { postId: 'post_id' } },
  feed_report: { name: 'feed_report', params: { postId: 'post_id', reason: 'reason' } },
  feed_similar_open: { name: 'feed_similar_open', params: { postId: 'post_id' } },
  feed_build_with_mine: { name: 'feed_build_with_mine', params: { postId: 'post_id', count: 'count' } },
};

function safeValue(value: AnalyticsParams[string]): string | number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return SAFE_VALUE.test(value) ? value : null;
  return null;
}

/** The GA4 event for an app event, or null when Firebase does not get it. */
export function toFirebaseEvent(name: AnalyticsEventName, params: AnalyticsParams = {}): FirebaseEvent | null {
  const rule = name === 'signup_step' ? signupRule(params) : FIREBASE_RULES[name];
  if (!rule) return null;
  const out: FirebaseParams = { ...rule.fixed };
  for (const [from, to] of Object.entries(rule.params ?? {})) {
    if (!(from in params)) continue;
    const value = safeValue(params[from]);
    if (value === null) continue;
    out[to] = value;
    if (Object.keys(out).length >= MAX_PARAMS) break;
  }
  return { name: rule.name, params: out };
}

/**
 * GA4 screen name of an expo-router route: its segments without the `(group)` parts, joined with "/" —
 * the route PATTERN (`item/[id]`), never the ids in the address. The root is "index".
 */
export function screenNameOf(segments: readonly string[]): string {
  const name = segments.filter((s) => !(s.startsWith('(') && s.endsWith(')'))).join('/');
  return (name || 'index').slice(0, 100);
}

/** User properties (GA4: name ≤ 24 chars, value ≤ 36 chars). Missing values are cleared with null. */
export type AnalyticsUserProperties = {
  plan: 'free' | 'premium' | null;
  app_language: string | null;
  onboarding_done: boolean | null;
  has_body_photo: boolean | null;
  has_face_photo: boolean | null;
  wardrobe_size_bucket: string | null;
  /** The style profile's segment (`women` | `men`), canvas 17. */
  segment: 'women' | 'men' | null;
};

/** Pieces in the wardrobe → a coarse bucket (never the exact count). */
export function wardrobeSizeBucket(count: number | null | undefined): string | null {
  if (count === null || count === undefined || !Number.isFinite(count) || count < 0) return null;
  if (count === 0) return '0';
  if (count < 10) return '1-9';
  if (count < 30) return '10-29';
  if (count < 100) return '30-99';
  return '100_plus';
}

export function toFirebaseUserProperties(props: AnalyticsUserProperties): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(props)) {
    const text = value === null ? null : String(value);
    out[key] = text !== null && SAFE_VALUE.test(text) ? text.slice(0, 36) : null;
  }
  return out;
}
