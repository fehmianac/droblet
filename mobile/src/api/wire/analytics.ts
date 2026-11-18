/**
 * Wire shape of `POST v1/tenant/event` (docs/api/store-social-settings.md §8) and the mapping from
 * the app's own event vocabulary (`../contracts/analytics`) to the server's allow-list.
 *
 * The app keeps tracking with its own names; the conversion happens here, when a batch is sent:
 * - `signup_step` becomes one funnel event per step;
 * - events the SERVER records itself (add to cart, brand checkout, share, invited install) are
 *   dropped — sending them is refused with `name_server_only`;
 * - props are limited to the allowed keys and to values matching `[A-Za-z0-9._:-]{1,64}`.
 */
import type { AnalyticsEvent, AnalyticsParams } from '../contracts/analytics';

export const EVENT_NAMES_WIRE = [
  'signup_started',
  'signup_completed',
  'onboarding_style_completed',
  'onboarding_body_completed',
  'onboarding_photo_completed',
  'onboarding_first_items_completed',
  'first_item_added',
  'first_look_created',
  'paywall_viewed',
  'subscribed',
  'credit_spent',
  'credits_exhausted',
  'complete_look_clicked',
] as const;
export type EventNameWire = (typeof EVENT_NAMES_WIRE)[number];

export const EVENT_PROP_KEYS = [
  'step',
  'source',
  'screen',
  'productId',
  'brandId',
  'lookId',
  'lookKind',
  'editId',
  'channel',
  'priceBand',
  'plan',
  'capability',
  'category',
  'count',
  'creditsRemaining',
] as const;
type PropKey = (typeof EVENT_PROP_KEYS)[number];

export const MAX_EVENT_PROPS = 8;

export type EventWire = { name: EventNameWire; occurredAt: string; props?: Record<string, string | number | boolean> };
/** 1–50 events. */
export type EventBatchWire = { platform: 'ios' | 'android'; appVersion: string; events: EventWire[] };
/** 200. Rejected events are never retried. 400 `validation_failed` only for the batch itself (`events_invalid`). */
export type EventBatchResponseWire = { accepted: number; rejected: { index: number; code: string }[] };

/** `signup_step` → the funnel event of that step; a step without one is not sent. */
const SIGNUP_STEPS: Record<string, EventNameWire> = {
  welcome: 'signup_started',
  account_created: 'signup_completed',
  style_profile: 'onboarding_style_completed',
  body_profile: 'onboarding_body_completed',
  first_items: 'onboarding_first_items_completed',
};

/** App param names that mean one of the allowed props. */
const PROP_ALIASES: Record<string, PropKey> = {
  from: 'source',
  feature: 'capability',
  method: 'source',
  kind: 'lookKind',
  band: 'priceBand',
  remaining: 'creditsRemaining',
  lineCount: 'count',
};

const VALUE_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

function toProps(params: AnalyticsParams, skip: readonly string[] = []): EventWire['props'] {
  const props: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    if (skip.includes(key) || value === null || value === undefined) continue;
    const name = (EVENT_PROP_KEYS as readonly string[]).includes(key) ? (key as PropKey) : PROP_ALIASES[key];
    if (!name || name in props) continue;
    if (typeof value === 'number' && !Number.isInteger(value)) continue;
    if (!VALUE_PATTERN.test(String(value))) continue;
    props[name] = value;
    if (Object.keys(props).length >= MAX_EVENT_PROPS) break;
  }
  return Object.keys(props).length > 0 ? props : undefined;
}

/** One app event → its wire event, or null when the server does not take it from the client. */
export function toEventWire(event: AnalyticsEvent): EventWire | null {
  if (event.name === 'signup_step') {
    const step = typeof event.params.step === 'string' ? event.params.step : '';
    const name = SIGNUP_STEPS[step];
    if (!name) return null;
    const wire: EventWire = { name, occurredAt: event.occurredAt };
    const props = toProps(event.params, ['step']);
    if (props) wire.props = props;
    // "Atla" on 04: the step was passed, but not completed with a photo.
    if (name === 'onboarding_body_completed' && typeof event.params.bodyPhotos === 'number' && event.params.bodyPhotos > 0) {
      wire.props = { ...wire.props, count: event.params.bodyPhotos };
    }
    return wire;
  }
  if (!(EVENT_NAMES_WIRE as readonly string[]).includes(event.name)) return null;
  const wire: EventWire = { name: event.name as EventNameWire, occurredAt: event.occurredAt };
  const props = toProps(event.params);
  if (props) wire.props = props;
  return wire;
}

/** The request body for a batch of app events; null when nothing in it is a client event. */
export function toEventBatchWire(events: AnalyticsEvent[], platform: 'ios' | 'android', appVersion: string): EventBatchWire | null {
  const wire = events.map(toEventWire).filter((e): e is EventWire => e !== null);
  return wire.length > 0 ? { platform, appVersion, events: wire } : null;
}
