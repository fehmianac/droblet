import {
  ANALYTICS_EVENTS,
  MAX_EVENTS_PER_BATCH,
  type AnalyticsEvent,
  type AnalyticsEventName,
  type AnalyticsParams,
  type EventBatchRequest,
} from '@/api/contracts/analytics';
import { ulid } from '@/lib/ids';

/**
 * Our own analytics (README §9.2: no third-party SDK): events are buffered in memory and handed to
 * a sink in batches of at most 50. The sink (bound by `AnalyticsHost` while a user is signed in)
 * puts each batch on the persisted mutation queue → `POST v1/tenant/event`, so batches survive
 * offline periods and restarts. Events tracked before sign-in (onboarding funnel) wait in the buffer.
 *
 * Only allow-listed event names (BRIEF §6) are accepted; params must be flat primitives and must
 * never carry personal data (no names, e-mails, photos or free text).
 */
export type AnalyticsSink = (batch: EventBatchRequest) => void;

/** Flush this long after the last event so a burst travels together. */
const FLUSH_DELAY_MS = 5_000;
/** Cap for events waiting without a sink (signed out / before sign-in); oldest are dropped first. */
const MAX_BUFFERED = 200;

let buffer: AnalyticsEvent[] = [];
let sink: AnalyticsSink | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function isAllowed(name: string): name is AnalyticsEventName {
  return (ANALYTICS_EVENTS as readonly string[]).includes(name);
}

function clearTimer() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

/** Sends everything buffered, in batches of at most 50. No-op while no sink is bound. */
export function flushAnalytics(): void {
  clearTimer();
  if (!sink) return;
  while (buffer.length > 0) {
    const events = buffer.slice(0, MAX_EVENTS_PER_BATCH);
    buffer = buffer.slice(MAX_EVENTS_PER_BATCH);
    sink({ clientMutationId: ulid(), events });
  }
}

export function track(name: AnalyticsEventName, params: AnalyticsParams = {}): void {
  if (!isAllowed(name)) return;
  buffer.push({ id: ulid(), name, occurredAt: new Date().toISOString(), params });
  if (buffer.length > MAX_BUFFERED) buffer = buffer.slice(buffer.length - MAX_BUFFERED);
  if (!sink) return;
  if (buffer.length >= MAX_EVENTS_PER_BATCH) {
    flushAnalytics();
    return;
  }
  clearTimer();
  timer = setTimeout(flushAnalytics, FLUSH_DELAY_MS);
}

/** Binds (or unbinds, with `null`) the batch sink. Binding flushes whatever was buffered meanwhile. */
export function bindAnalyticsSink(next: AnalyticsSink | null): void {
  sink = next;
  if (next) flushAnalytics();
  else clearTimer();
}

/** Test helper. */
export function resetAnalytics(): void {
  clearTimer();
  buffer = [];
  sink = null;
}

export function pendingAnalyticsCount(): number {
  return buffer.length;
}
