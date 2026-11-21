import { DEFAULT_TEEN_CONFIG, type TeenConfig, type TeenState } from '@/api/contracts/teen';
import { toTeenConfig, toTeenState, type TeenWire } from '@/api/wire/teen';
import {
  firebaseAgeGate,
  firebaseCollecting,
  pendingFirebaseCount,
  sendFirebaseEvent,
  setFirebaseAgeGate,
  setFirebaseClientForTests,
  setFirebaseCollection,
  setFirebaseUserId,
  setFirebaseUserProperties,
  type FirebaseAnalyticsClient,
} from '@/analytics/firebase';
import { profileCompletion } from '@/features/requirements/logic';

import { ageOutcome, bandOf, birthYears } from './age';
import { teenGateStop } from './gate';
import { teenRules } from './rules';
import { noticeFor } from './TeenHost';

const ON: TeenConfig = { enabled: true, tryOnEnabled: true, minimumAge: 16, adultAge: 18 };
const OFF: TeenConfig = { ...ON, tryOnEnabled: false };

function teen(wire: Partial<TeenWire> & Pick<TeenWire, 'status'>): TeenState {
  return toTeenState({ ageBand: 'teen', teen: { request: { state: 'sent', parentEmailMasked: 'a***@o***.com' }, ...wire } });
}

describe('age gating at sign-up (docs/api/teen.md §3)', () => {
  const now = new Date(2026, 10, 21); // 21 November 2026

  it('under 16, teen and adult by year; ambiguous years ask the month', () => {
    expect(ageOutcome(2014, null, ON, now)).toBe('underage');
    expect(ageOutcome(2011, null, ON, now)).toBe('underage'); // 14 or 15
    expect(ageOutcome(2010, null, ON, now)).toBe('needsMonth'); // 15 or 16
    expect(ageOutcome(2009, null, ON, now)).toBe('teen'); // 16 or 17
    expect(ageOutcome(2008, null, ON, now)).toBe('needsMonth'); // 17 or 18
    expect(ageOutcome(2007, null, ON, now)).toBe('adult'); // 18 or 19
    expect(ageOutcome(1990, null, ON, now)).toBe('adult');
  });

  it('with a month, the birthday counts from the first day of the next month', () => {
    // Born October 2010: reached 16 on 1 November 2026 → teen. Born November 2010: not until 1 December → under 16.
    expect(ageOutcome(2010, 10, ON, now)).toBe('teen');
    expect(ageOutcome(2010, 11, ON, now)).toBe('underage');
    // Born October 2008: 18 since 1 November → adult. Born December 2008: still 17 → teen.
    expect(ageOutcome(2008, 10, ON, now)).toBe('adult');
    expect(ageOutcome(2008, 12, ON, now)).toBe('teen');
  });

  it('teen sign-up closed on the server: a 16–17 year old gets the "coming soon" outcome', () => {
    expect(ageOutcome(2009, null, { ...ON, enabled: false }, now)).toBe('teenClosed');
    expect(ageOutcome(1990, null, { ...ON, enabled: false }, now)).toBe('adult');
    expect(bandOf('teen')).toBe('teen');
    expect(bandOf('adult')).toBe('adult');
    expect(bandOf('underage')).toBeNull();
  });

  it('the year list is newest first and lets a younger child answer', () => {
    const years = birthYears(now);
    expect(years[0]).toBe(2016);
    expect(years.at(-1)).toBe(1926);
  });
});

describe('teen state from the wire (§5)', () => {
  it('maps the server status to the app vocabulary', () => {
    expect(teen({ status: 'pendingParentalConsent', request: { state: 'none' } }).teen?.consent).toBe('none');
    expect(teen({ status: 'pendingParentalConsent' }).teen?.consent).toBe('pending');
    expect(teen({ status: 'pendingParentalConsent', request: { state: 'expired' } }).teen).toMatchObject({
      consent: 'pending',
      requestState: 'expired',
    });
    expect(teen({ status: 'active', parentAllowedTryOn: true }).teen).toMatchObject({
      consent: 'approved',
      parentAllowedTryOn: true,
      parentEmailMasked: 'a***@o***.com',
    });
    expect(teen({ status: 'declined' }).teen?.consent).toBe('declined');
    expect(teen({ status: 'withdrawn' }).teen?.consent).toBe('withdrawn');
    // An adult never carries a teen object; an unknown band stays unknown.
    expect(toTeenState({ ageBand: 'adult', teen: null })).toEqual({ ageBand: 'adult', teen: null });
    expect(toTeenState({ ageBand: null, teen: null })).toEqual({ ageBand: null, teen: null });
  });

  it('config: absent = teen sign-up closed and try-on off', () => {
    expect(toTeenConfig(undefined)).toEqual(DEFAULT_TEEN_CONFIG);
    expect(toTeenConfig({ enabled: true, tryOnEnabled: false, minimumAge: 16, adultAge: 18 })).toEqual(OFF);
  });
});

describe('useTeenRules — states and hidden surfaces', () => {
  it('adult (and an unknown band): nothing hidden, nothing locked', () => {
    for (const r of [teenRules({ ageBand: 'adult', teen: null }, ON), teenRules(null, ON), teenRules(null, ON, 'adult')]) {
      expect(r.isTeen).toBe(false);
      expect(r.limited).toBe(false);
      expect(r.tryOn).toBe('open');
      expect(Object.values(r.hide).every((h) => h === false)).toBe(true);
    }
  });

  it('every teen surface is hidden in every state: social, store, paywall, analytics, marketing, outfit-photo try-on, sponsored', () => {
    for (const status of ['pendingParentalConsent', 'active', 'declined', 'withdrawn'] as const) {
      const r = teenRules(teen({ status }), ON);
      expect(r.hide).toEqual({
        social: true,
        commerce: true,
        paywall: true,
        analytics: true,
        marketing: true,
        outfitPhotoTryOn: true,
        sponsored: true,
      });
    }
  });

  it('pending, declined and withdrawn are limited; approved is not', () => {
    expect(teenRules(teen({ status: 'pendingParentalConsent' }), ON)).toMatchObject({ consent: 'pending', limited: true, needsParentEmail: false });
    expect(teenRules(teen({ status: 'pendingParentalConsent', request: { state: 'none' } }), ON)).toMatchObject({
      consent: 'none',
      limited: true,
      needsParentEmail: true,
    });
    expect(teenRules(teen({ status: 'declined' }), ON)).toMatchObject({ consent: 'declined', limited: true });
    expect(teenRules(teen({ status: 'withdrawn' }), ON)).toMatchObject({ consent: 'withdrawn', limited: true });
    expect(teenRules(teen({ status: 'active' }), ON)).toMatchObject({ consent: 'approved', limited: false });
  });

  it('a session that remembers "teen" stays a limited teen until the server answers', () => {
    expect(teenRules(null, ON, 'teen')).toMatchObject({ isTeen: true, limited: true, consent: 'pending' });
  });

  it('try-on lock states: limited, flag off, parent box, own consent', () => {
    expect(teenRules(teen({ status: 'pendingParentalConsent' }), ON).tryOn).toBe('limited');
    expect(teenRules(teen({ status: 'active', parentAllowedTryOn: true }), OFF).tryOn).toBe('unavailable');
    expect(teenRules(teen({ status: 'active', parentAllowedTryOn: true, tryOn: { available: false, reason: 'feature_off' } }), ON).tryOn).toBe(
      'unavailable',
    );
    expect(teenRules(teen({ status: 'active', parentAllowedTryOn: false }), ON).tryOn).toBe('needsParent');
    const open = teenRules(
      teen({ status: 'active', parentAllowedTryOn: true, ownTryOnConsent: false, tryOn: { available: false, reason: 'own_consent_missing' } }),
      ON,
    );
    expect(open).toMatchObject({ tryOn: 'open', needsOwnTryOnConsent: true });
    expect(teenRules(teen({ status: 'active', parentAllowedTryOn: true, ownTryOnConsent: true, tryOn: { available: true } }), ON)).toMatchObject({
      tryOn: 'open',
      needsOwnTryOnConsent: false,
    });
  });

  it('the gate of a gated action: hidden social, locked AI, try-on lock and the 22t explainer', () => {
    const pending = teenRules(teen({ status: 'pendingParentalConsent' }), ON);
    const approvedNoBox = teenRules(teen({ status: 'active', parentAllowedTryOn: false }), ON);
    const approvedOpen = teenRules(teen({ status: 'active', parentAllowedTryOn: true }), ON);
    const adult = teenRules({ ageBand: 'adult', teen: null }, ON);
    expect(teenGateStop('social', pending)).toBe('hidden');
    expect(teenGateStop('contacts', approvedOpen)).toBe('hidden');
    expect(teenGateStop('stylist', pending)).toBe('locked');
    expect(teenGateStop('palette', pending)).toBe('locked');
    expect(teenGateStop('stylist', approvedOpen)).toBeNull();
    expect(teenGateStop('tryOn', pending)).toBe('tryOnLocked');
    expect(teenGateStop('tryOn', approvedNoBox)).toBe('tryOnLocked');
    expect(teenGateStop('tryOn', approvedOpen)).toBe('explainer');
    expect(teenGateStop('tryOn', adult)).toBeNull();
    expect(teenGateStop('social', adult)).toBeNull();
  });

  it('"Profilini tamamla" leaves out the @username for a teen and the photos while limited', () => {
    const input = {
      ageConfirmed: true,
      validConsents: [],
      hasBodyPhoto: false,
      hasFacePhoto: false,
      bodyType: null,
      hasBodyProfile: true,
      isMember: false,
      creditsRemaining: 0,
      cityId: null,
      handle: null,
      itemCount: 0,
      cityDeclined: false,
    };
    const keys = (teenOpts?: { social: boolean; photos: boolean }) => profileCompletion(input, teenOpts).map((i) => i.key);
    expect(keys()).toContain('handle');
    expect(keys({ social: false, photos: true })).not.toContain('handle');
    expect(keys({ social: false, photos: false })).toEqual(['bodyType', 'city', 'firstItems']);
  });
});

describe('one-time notices', () => {
  it('approved, declined, withdrawn and turning 18; the first sight shows nothing', () => {
    expect(noticeFor(null, { band: 'teen', consent: 'approved' })).toBeNull();
    expect(noticeFor({ band: 'teen', consent: 'pending' }, { band: 'teen', consent: 'approved' })).toBe('approved');
    expect(noticeFor({ band: 'teen', consent: 'pending' }, { band: 'teen', consent: 'declined' })).toBe('declined');
    expect(noticeFor({ band: 'teen', consent: 'approved' }, { band: 'teen', consent: 'withdrawn' })).toBe('withdrawn');
    expect(noticeFor({ band: 'teen', consent: 'approved' }, { band: 'adult', consent: 'none' })).toBe('adult');
    expect(noticeFor({ band: 'teen', consent: 'none' }, { band: 'teen', consent: 'pending' })).toBeNull();
    expect(noticeFor({ band: 'adult', consent: 'none' }, { band: 'adult', consent: 'none' })).toBeNull();
  });
});

describe('Firebase stays off for teens', () => {
  function fakeClient() {
    const calls = { collection: [] as boolean[], events: [] as string[], userIds: [] as (string | null)[], props: 0 };
    const client: FirebaseAnalyticsClient = {
      setCollectionEnabled: async (enabled) => {
        calls.collection.push(enabled);
      },
      logEvent: async (name) => {
        calls.events.push(name);
      },
      setUserId: async (id) => {
        calls.userIds.push(id);
      },
      setUserProperties: async () => {
        calls.props += 1;
      },
    };
    return { client, calls };
  }

  afterEach(() => setFirebaseClientForTests(undefined));

  it('blocked: setAnalyticsCollectionEnabled(false), no events, no user id, no user properties — even with the choice on', () => {
    const { client, calls } = fakeClient();
    setFirebaseClientForTests(client, 'unknown');
    sendFirebaseEvent({ name: 'screen_view', params: { screen_name: 'index' } });
    setFirebaseCollection(true);
    // The age is not known yet: nothing goes out, collection is not switched on.
    expect(calls.events).toEqual([]);
    expect(calls.collection).toEqual([]);
    expect(pendingFirebaseCount()).toBe(1);

    setFirebaseAgeGate('blocked');
    expect(firebaseAgeGate()).toBe('blocked');
    expect(calls.collection).toEqual([false]);
    expect(calls.userIds).toEqual([null]);
    expect(pendingFirebaseCount()).toBe(0);
    expect(firebaseCollecting()).toBe(false);

    sendFirebaseEvent({ name: 'login', params: {} });
    setFirebaseUserId('actor');
    setFirebaseUserProperties({ segment: 'women' });
    setFirebaseCollection(true);
    expect(calls.events).toEqual([]);
    expect(calls.props).toBe(0);
    expect(calls.userIds).toEqual([null]);
    expect(calls.collection).toEqual([false]);
  });

  it('an adult: the buffered events go out once the gate opens', () => {
    const { client, calls } = fakeClient();
    setFirebaseClientForTests(client, 'unknown');
    setFirebaseCollection(true);
    sendFirebaseEvent({ name: 'screen_view', params: { screen_name: 'index' } });
    setFirebaseAgeGate('open');
    expect(calls.collection).toEqual([true]);
    expect(calls.events).toEqual(['screen_view']);
    expect(firebaseCollecting()).toBe(true);
  });
});
