import { getApps } from '@react-native-firebase/app';
import {
  getAnalytics,
  logEvent,
  setAnalyticsCollectionEnabled,
  setUserId,
  setUserProperties,
} from '@react-native-firebase/analytics';

import type { FirebaseEvent, FirebaseParams } from './firebaseEvents';

/**
 * The Firebase Analytics sink (GA4), next to our own first-party analytics (`track.ts`).
 *
 * - The native SDK starts with collection OFF (Info.plist `FIREBASE_ANALYTICS_COLLECTION_ENABLED` /
 *   manifest `firebase_analytics_collection_enabled` = false, see `plugins/withFirebaseAnalyticsPrivacy.js`):
 *   nothing — not even `first_open` — is sent until this module switches it on, which it does only once the
 *   user's "Ürün analitiği" choice is known and on (`setFirebaseCollection`, from `preference.ts`).
 * - Fixture / showcase builds (`EXPO_PUBLIC_DROBLET_FIXTURES=1`) and Jest never send anything.
 * - A build without the Firebase config files (no `GoogleService-Info.plist` / `google-services.json`)
 *   has no default Firebase app: every call is a no-op.
 * - Events tracked before the choice is read wait in a small buffer; they are dropped if it is off.
 */
export type FirebaseAnalyticsClient = {
  setCollectionEnabled(enabled: boolean): Promise<void>;
  logEvent(name: string, params: FirebaseParams): Promise<void>;
  setUserId(id: string | null): Promise<void>;
  setUserProperties(props: Record<string, string | null>): Promise<void>;
};

const MAX_PENDING = 50;

/** undefined = not resolved yet; null = no Firebase in this build. */
let client: FirebaseAnalyticsClient | null | undefined;
/** The user's choice; null until `preference.ts` has read it. */
let allowed: boolean | null = null;
let pending: FirebaseEvent[] = [];

/** Showcase / fixture builds never report (their data is not real usage). Read at call time. */
export function isFixturesBuild(): boolean {
  return process.env.EXPO_PUBLIC_DROBLET_FIXTURES === '1';
}

function nativeClient(): FirebaseAnalyticsClient | null {
  // Jest has no native modules; tests inject a fake with `setFirebaseClientForTests`.
  if (process.env.JEST_WORKER_ID !== undefined) return null;
  try {
    if (getApps().length === 0) return null;
    const analytics = getAnalytics();
    return {
      setCollectionEnabled: (enabled) => setAnalyticsCollectionEnabled(analytics, enabled),
      // The typed overloads demand per-event shapes for GA4's recommended names; our params are already
      // allow-listed and sanitised (`firebaseEvents.ts`), so the loose signature is used.
      logEvent: async (name, params) => {
        await (logEvent as unknown as (a: typeof analytics, n: string, p: FirebaseParams) => unknown)(analytics, name, params);
      },
      setUserId: (id) => setUserId(analytics, id),
      setUserProperties: (props) => setUserProperties(analytics, props),
    };
  } catch {
    // Expo Go / a dev client built without the native module.
    return null;
  }
}

function currentClient(): FirebaseAnalyticsClient | null {
  if (isFixturesBuild()) return null;
  if (client === undefined) client = nativeClient();
  return client;
}

/** Fire and forget: analytics never surfaces an error. */
function run(call: (c: FirebaseAnalyticsClient) => Promise<void>): void {
  const c = currentClient();
  if (!c) return;
  try {
    void call(c).catch(() => undefined);
  } catch {
    // A synchronous throw from the native bridge.
  }
}

/** Whether events go to Firebase right now. */
export function firebaseCollecting(): boolean {
  return allowed === true && currentClient() !== null;
}

/** Applies the user's "Ürün analitiği" choice to the native SDK (persisted there too) and flushes / drops the buffer. */
export function setFirebaseCollection(enabled: boolean): void {
  allowed = enabled;
  run((c) => c.setCollectionEnabled(enabled));
  const waiting = pending;
  pending = [];
  if (enabled) waiting.forEach((e) => run((c) => c.logEvent(e.name, e.params)));
}

export function sendFirebaseEvent(event: FirebaseEvent): void {
  if (allowed === false || !currentClient()) return;
  if (allowed === null) {
    pending.push(event);
    if (pending.length > MAX_PENDING) pending = pending.slice(pending.length - MAX_PENDING);
    return;
  }
  run((c) => c.logEvent(event.name, event.params));
}

/** GA4 `screen_view` with the route pattern as both name and class. */
export function sendFirebaseScreenView(screen: string): void {
  sendFirebaseEvent({ name: 'screen_view', params: { screen_name: screen, screen_class: screen } });
}

/** The pseudonymous actor hash (`actor.ts`), or null on sign-out. Never an e-mail, name or raw account id. */
export function setFirebaseUserId(id: string | null): void {
  if (!firebaseCollecting() && id !== null) return;
  run((c) => c.setUserId(id));
}

export function setFirebaseUserProperties(props: Record<string, string | null>): void {
  if (!firebaseCollecting()) return;
  run((c) => c.setUserProperties(props));
}

/** Tests: use this client instead of the native one (null = no Firebase), and forget the choice and the buffer. */
export function setFirebaseClientForTests(next: FirebaseAnalyticsClient | null | undefined): void {
  client = next;
  allowed = null;
  pending = [];
}

export function pendingFirebaseCount(): number {
  return pending.length;
}
