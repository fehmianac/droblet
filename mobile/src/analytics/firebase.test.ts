import { createHash } from 'node:crypto';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { ANALYTICS_EVENTS, type AnalyticsEventName } from '@/api/contracts/analytics';

import { analyticsActor } from './actor';
import { setFirebaseClientForTests, setFirebaseUserProperties, type FirebaseAnalyticsClient } from './firebase';
import {
  FIREBASE_RULES,
  MAX_EVENT_NAME,
  MAX_PARAM_NAME,
  MAX_PARAMS,
  RESERVED_EVENT_NAMES,
  RESERVED_PREFIXES,
  screenNameOf,
  toFirebaseEvent,
  toFirebaseUserProperties,
  wardrobeSizeBucket,
} from './firebaseEvents';
import { reportJobSettled, resetJobEventsForTests, trackTryOnStarted } from './jobEvents';
import { resetProductAnalyticsForTests, restoreProductAnalytics, setProductAnalyticsEnabled } from './preference';
import { pendingAnalyticsCount, resetAnalytics, track, trackScreen } from './track';

type Logged = { name: string; params: Record<string, string | number> };

function fakeClient() {
  const events: Logged[] = [];
  const collection: boolean[] = [];
  const userIds: (string | null)[] = [];
  const userProps: Record<string, string | null>[] = [];
  const client: FirebaseAnalyticsClient = {
    setCollectionEnabled: async (enabled) => {
      collection.push(enabled);
    },
    logEvent: async (name, params) => {
      events.push({ name, params });
    },
    setUserId: async (id) => {
      userIds.push(id);
    },
    setUserProperties: async (props) => {
      userProps.push(props);
    },
  };
  return { client, events, collection, userIds, userProps };
}

const EMAIL = 'damla@example.com';
const URL = 'https://cdn.example.com/photo/123.jpg';
const FREE_TEXT = 'Kırmızı elbise ve siyah ceket';

/** Fails if any value sent to Firebase looks like an e-mail, a URL or free text. */
function expectNoPii(events: Logged[]) {
  for (const e of events) {
    for (const value of Object.values(e.params)) {
      const text = String(value);
      expect(text).not.toMatch(/@/);
      expect(text).not.toMatch(/:\/\/|\//);
      expect(text).not.toMatch(/\s/);
    }
  }
}

beforeEach(async () => {
  resetAnalytics();
  resetProductAnalyticsForTests();
  resetJobEventsForTests();
  setFirebaseClientForTests(undefined);
  delete process.env.EXPO_PUBLIC_DROBLET_FIXTURES;
  await AsyncStorage.clear();
});

describe('track() routing to Firebase', () => {
  it('sends to Firebase only while product analytics is on (default on)', async () => {
    const fb = fakeClient();
    setFirebaseClientForTests(fb.client);
    await restoreProductAnalytics();
    expect(fb.collection).toEqual([true]);

    track('signup_step', { step: 'account_created', method: 'apple' });
    expect(fb.events).toEqual([{ name: 'sign_up', params: { method: 'apple' } }]);

    await setProductAnalyticsEnabled(false);
    expect(fb.collection).toEqual([true, false]);
    track('paywall_viewed', { from: 'onboarding' });
    expect(fb.events).toHaveLength(1);
    expect(await AsyncStorage.getItem('droblet.productAnalytics')).toBe('0');

    await setProductAnalyticsEnabled(true);
    track('paywall_viewed', { from: 'onboarding' });
    expect(fb.events.at(-1)).toEqual({ name: 'paywall_view', params: { source: 'onboarding' } });
  });

  it('keeps an opt-out across restarts and drops what waited for the choice', async () => {
    await AsyncStorage.setItem('droblet.productAnalytics', '0');
    const fb = fakeClient();
    setFirebaseClientForTests(fb.client);
    track('signup_step', { step: 'welcome' }); // before the choice is read: waits
    await restoreProductAnalytics();
    expect(fb.collection).toEqual([false]);
    expect(fb.events).toEqual([]);
  });

  it('flushes events tracked before the choice was read when it is on', async () => {
    const fb = fakeClient();
    setFirebaseClientForTests(fb.client);
    track('signup_step', { step: 'welcome' });
    expect(fb.events).toEqual([]);
    await restoreProductAnalytics();
    expect(fb.events).toEqual([{ name: 'tutorial_begin', params: {} }]);
  });

  it('still feeds the first-party sink when Firebase is off', async () => {
    const fb = fakeClient();
    setFirebaseClientForTests(fb.client);
    await setProductAnalyticsEnabled(false);
    track('paywall_viewed', { from: 'x' });
    expect(fb.events).toEqual([]);
    expect(pendingAnalyticsCount()).toBe(1);
  });

  it('sends nothing from a fixtures build or without a Firebase app', async () => {
    process.env.EXPO_PUBLIC_DROBLET_FIXTURES = '1';
    const fb = fakeClient();
    setFirebaseClientForTests(fb.client);
    await restoreProductAnalytics();
    track('paywall_viewed', { from: 'x' });
    trackScreen(['(tabs)', 'wardrobe']);
    expect(fb.events).toEqual([]);
    expect(fb.collection).toEqual([]);

    delete process.env.EXPO_PUBLIC_DROBLET_FIXTURES;
    setFirebaseClientForTests(null); // = no GoogleService file / native module
    track('paywall_viewed', { from: 'x' });
    expect(fb.events).toEqual([]);
  });
});

describe('no personal data reaches Firebase', () => {
  it('drops e-mail-like, URL-like and free-text values from every event', async () => {
    const fb = fakeClient();
    setFirebaseClientForTests(fb.client);
    await restoreProductAnalytics();
    for (const name of ANALYTICS_EVENTS) {
      for (const bad of [EMAIL, URL, FREE_TEXT]) {
        track(name, {
          step: bad,
          method: bad,
          from: bad,
          source: bad,
          productId: bad,
          brandId: bad,
          channel: bad,
          kind: bad,
          path: bad,
          target: bad,
          type: bad,
          reason: bad,
          surface: bad,
          contentType: bad,
          errorCode: bad,
          email: bad,
          name: bad,
          photoUrl: bad,
          itemName: bad,
        });
      }
    }
    expect(fb.events.length).toBeGreaterThan(0);
    expectNoPii(fb.events);
  });

  it('never sends params that are not on the event allow-list', () => {
    const event = toFirebaseEvent('cart_added', { productId: 'p_1', brandId: 'b_1', email: 'x', displayName: 'Damla', clickId: 'c1' });
    expect(event).toEqual({ name: 'add_to_cart', params: { item_id: 'p_1', item_brand: 'b_1' } });
    expect(toFirebaseEvent('brand_checkout_opened', { brandId: 'b_1', clickId: 'c_1', lineCount: 2 })).toEqual({
      name: 'begin_checkout',
      params: { checkout: 'brand_site', item_brand: 'b_1', count: 2 },
    });
  });

  it('user properties carry only identifier-like values', () => {
    expect(
      toFirebaseUserProperties({
        plan: 'premium',
        app_language: 'tr',
        onboarding_done: true,
        has_body_photo: false,
        has_face_photo: null,
        wardrobe_size_bucket: wardrobeSizeBucket(42),
        segment: 'men',
      }),
    ).toEqual({
      plan: 'premium',
      app_language: 'tr',
      onboarding_done: 'true',
      has_body_photo: 'false',
      has_face_photo: null,
      wardrobe_size_bucket: '30-99',
      segment: 'men',
    });
  });
});

describe('GA4 naming rules', () => {
  const reserved = new Set<string>(RESERVED_EVENT_NAMES);
  const names = new Set<string>(['tutorial_begin', 'sign_up', 'tutorial_complete', 'onboarding_step']);
  const params = new Set<string>(['method', 'step', 'count', 'skipped', 'body_photos', 'face_photo']);
  for (const rule of Object.values(FIREBASE_RULES)) {
    if (!rule) continue;
    names.add(rule.name);
    Object.values(rule.params ?? {}).forEach((p) => params.add(p));
    Object.keys(rule.fixed ?? {}).forEach((p) => params.add(p));
    it(`${rule.name}: ≤ ${MAX_PARAMS} params`, () => {
      expect(Object.keys(rule.params ?? {}).length + Object.keys(rule.fixed ?? {}).length).toBeLessThanOrEqual(MAX_PARAMS);
    });
  }

  it('event names are snake_case, ≤ 40 chars, not reserved', () => {
    for (const name of names) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(name.length).toBeLessThanOrEqual(MAX_EVENT_NAME);
      expect(reserved.has(name)).toBe(false);
      for (const prefix of RESERVED_PREFIXES) expect(name.startsWith(prefix)).toBe(false);
    }
  });

  it('param names are snake_case and ≤ 40 chars', () => {
    for (const name of params) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(name.length).toBeLessThanOrEqual(MAX_PARAM_NAME);
      for (const prefix of RESERVED_PREFIXES) expect(name.startsWith(prefix)).toBe(false);
    }
  });

  it('every app event has a Firebase rule (or an explicit null)', () => {
    const covered = new Set<AnalyticsEventName>(['signup_step', ...(Object.keys(FIREBASE_RULES) as AnalyticsEventName[])]);
    for (const name of ANALYTICS_EVENTS) expect(covered.has(name)).toBe(true);
  });
});

describe('screen views and user identity', () => {
  it('names a screen by its route pattern, never by ids', async () => {
    expect(screenNameOf(['(tabs)', 'wardrobe'])).toBe('wardrobe');
    expect(screenNameOf(['item', '[id]'])).toBe('item/[id]');
    expect(screenNameOf(['(tabs)'])).toBe('index');
    expect(screenNameOf([])).toBe('index');

    const fb = fakeClient();
    setFirebaseClientForTests(fb.client);
    await restoreProductAnalytics();
    trackScreen(['shop', 'product', '[id]']);
    expect(fb.events).toEqual([{ name: 'screen_view', params: { screen_name: 'shop/product/[id]', screen_class: 'shop/product/[id]' } }]);
  });

  it('the user id is the server actor hash of the tenant id', async () => {
    const nodeSha = async (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
    // = AnalyticsRules.Actor("01HTENANT") on the server.
    expect(await analyticsActor('01HTENANT', nodeSha)).toBe('18c77e3eb958d704a0b2ad3661d32c5b');
  });

  it('sets user properties only while collecting', async () => {
    const fb = fakeClient();
    setFirebaseClientForTests(fb.client);
    setFirebaseUserProperties({ plan: 'free' });
    expect(fb.userProps).toEqual([]);
    await restoreProductAnalytics();
    setFirebaseUserProperties({ plan: 'free' });
    expect(fb.userProps).toEqual([{ plan: 'free' }]);
  });

  it('wardrobe size buckets', () => {
    expect([0, 1, 9, 10, 29, 30, 99, 100, 500].map(wardrobeSizeBucket)).toEqual(['0', '1-9', '1-9', '10-29', '10-29', '30-99', '30-99', '100_plus', '100_plus']);
    expect(wardrobeSizeBucket(undefined)).toBeNull();
  });
});

describe('AI job events', () => {
  it('reports a try-on outcome once, with the path of its start', async () => {
    const fb = fakeClient();
    setFirebaseClientForTests(fb.client);
    await restoreProductAnalytics();
    trackTryOnStarted('job_1', 'look', 'face');
    const failed = { status: 'failed' as const, result: null, error: { code: 'model_error', creditRefunded: true } };
    reportJobSettled('tryon', 'job_1', failed);
    reportJobSettled('tryon', 'job_1', failed);
    expect(fb.events).toEqual([
      { name: 'tryon_start', params: { path: 'face', cached: 'false', credit_cost: 1, target: 'look' } },
      { name: 'tryon_failed', params: { path: 'face', error_code: 'model_error', credit_refunded: 'true', target: 'look' } },
    ]);
  });

  it('an image that already existed is a free, complete try-on', async () => {
    const fb = fakeClient();
    setFirebaseClientForTests(fb.client);
    await restoreProductAnalytics();
    trackTryOnStarted('img:abc', 'item', 'body');
    expect(fb.events.map((e) => [e.name, e.params.cached, e.params.credit_cost])).toEqual([
      ['tryon_start', 'true', 0],
      ['tryon_complete', 'true', 0],
    ]);
  });

  it('maps stylist, week and trip jobs to their events', async () => {
    const fb = fakeClient();
    setFirebaseClientForTests(fb.client);
    await restoreProductAnalytics();
    reportJobSettled('stylist-outfit', 'j1', { status: 'done', result: { suggestions: [{}, {}, {}] }, error: null });
    reportJobSettled('stylist-week', 'j2', { status: 'done', result: { days: [{}, {}] }, error: null });
    reportJobSettled('trip-pack', 'j3', { status: 'done', result: { items: [{}] }, error: null });
    reportJobSettled('trip-pack', 'j4', { status: 'running', result: null, error: null } as never);
    expect(fb.events.map((e) => [e.name, e.params.count])).toEqual([
      ['outfit_suggested', 3],
      ['week_planned', 2],
      ['trip_packed', 1],
    ]);
  });
});
