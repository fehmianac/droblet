import type { AnalyticsEvent } from '@/api/contracts/analytics';
import {
  fromNotificationSettings,
  fromVisibility,
  toMyPhotos,
  toMyProfile,
  toNotificationSettings,
  toProfileStats,
} from '@/api/wire/account';
import { toEventBatchWire, toEventWire } from '@/api/wire/analytics';
import { toPalette, toSeasonType } from '@/api/wire/palette';
import { toQuarterHour } from '@/notify/time';

describe('account wire mappers', () => {
  it('maps ProfileDto to the app profile (followersOnly → followers, version → baseVersion)', () => {
    const profile = toMyProfile(
      {
        tenantId: '01M7R4Q8TQAVTPEYERC536MM76',
        displayName: 'Smoke Probe',
        handle: null,
        email: 'smoke@example.com',
        closetVisibility: 'followersOnly',
        language: 'tr',
        cityId: null,
        version: 3,
        updatedAt: '2026-11-18T20:14:11Z',
      },
      ['minimal', 'quiet_luxury', 'office_chic'],
    );
    expect(profile).toMatchObject({
      handle: null,
      displayName: 'Smoke Probe',
      avatarUrl: null,
      closetVisibility: 'followers',
      language: 'tr',
      baseVersion: 3,
      styleTags: ['minimal', 'quiet_luxury', 'office_chic'],
    });
    expect(fromVisibility('followers')).toBe('followersOnly');
    expect(fromVisibility('private')).toBe('private');
  });

  it('keeps an unsupported server language as null, so the app language is written', () => {
    const wire = { tenantId: 't', displayName: null, handle: 'a', email: null, closetVisibility: 'private' as const, language: 'de', cityId: null, version: 1, updatedAt: '' };
    expect(toMyProfile(wire, []).language).toBeNull();
    expect(toMyProfile(wire, []).displayName).toBe('');
  });

  it('maps stats and the single active photo per kind', () => {
    expect(toProfileStats({ itemCount: 2, lookCount: 1, tripCount: 0, followerCount: 3, followingCount: 4 })).toEqual({
      itemCount: 2,
      lookCount: 1,
      tripCount: 0,
      followerCount: 3,
      followingCount: 4,
    });
    const photo = { id: 'p1', kind: 'body' as const, contentType: 'image/jpeg', sizeBytes: 1, createdAt: '', url: 'https://x/p1', urlExpiresAt: '' };
    expect(toMyPhotos({ body: photo, face: null })).toEqual({ body: [{ photoId: 'p1', url: 'https://x/p1' }], face: null, generatedImageCount: null });
    expect(toMyPhotos({ body: null, face: null }).body).toEqual([]);
  });

  it('notification preferences travel as local time + IANA zone', () => {
    const settings = toNotificationSettings({
      morningOutfit: true,
      morningOutfitLocalTime: '07:30',
      weeklyEdit: true,
      friendRatings: false,
      timeZone: 'Europe/Istanbul',
      version: 2,
      updatedAt: null,
    });
    // A server without the newer switches reads as off — except the like digest (Akış F2), on unless switched off.
    expect(settings).toEqual({
      morningReminder: true,
      morningTimeLocal: '07:30',
      weeklyEdit: true,
      friendRatings: false,
      priceDrop: false,
      followRequests: false,
      feedLikesDigest: true,
      baseVersion: 2,
    });
    expect(fromNotificationSettings({ ...settings, priceDrop: true }, 'Europe/Istanbul')).toEqual({
      morningOutfit: true,
      morningOutfitLocalTime: '07:30',
      weeklyEdit: true,
      friendRatings: false,
      priceDrop: true,
      followRequests: false,
      feedLikesDigest: true,
      timeZone: 'Europe/Istanbul',
      baseVersion: 2,
    });
    expect(
      toNotificationSettings({
        morningOutfit: true,
        morningOutfitLocalTime: '07:30',
        weeklyEdit: true,
        friendRatings: false,
        priceDrop: true,
        followRequests: true,
        feedLikesDigest: false,
        timeZone: 'Europe/Istanbul',
        version: 3,
        updatedAt: null,
      }),
    ).toMatchObject({ priceDrop: true, followRequests: true, feedLikesDigest: false, baseVersion: 3 });
    expect(toQuarterHour('07:37')).toBe('07:30');
    expect(toQuarterHour('23:55')).toBe('00:00');
  });
});

describe('palette wire mapper', () => {
  it('maps PaletteDto: kebab season id, resolved tone names, compatibility percent', () => {
    const palette = toPalette({
      seasonTypeId: 'bright-spring',
      seasonName: 'Parlak İlkbahar',
      flattering: [{ id: 'camel', family: 'brown', hex: '#C19A6B', name: 'Camel' }],
      avoid: [{ id: 'fuchsia', family: 'pink', hex: '#E83E8C', name: 'Fuşya' }],
      lowConfidence: false,
      sourcePhotoActive: true,
      analyzedAt: '2026-11-18T09:00:00Z',
      compatibility: { percent: 67, totalCount: 3, compatibleCount: 1, neutralCount: 1, incompatibleCount: 1, unmatchedCount: 0, neutralsCountAsCompatible: true },
    });
    expect(palette).toMatchObject({ status: 'ready', seasonType: 'bright_spring', wardrobeMatchPercent: 67 });
    if (palette.status !== 'ready') throw new Error('unreachable');
    expect(palette.tones[0]).toEqual({ id: 'camel', hex: '#C19A6B', name: 'Camel', catalogColor: 'camel' });
    expect(palette.avoid[0]?.catalogColor).toBeNull();
  });

  it('falls back to a known season for an unknown id', () => {
    expect(toSeasonType('warm-autumn')).toBe('warm_autumn');
    expect(toSeasonType('muted-winter')).toBe('deep_winter');
  });
});

describe('analytics wire mapper', () => {
  const event = (name: AnalyticsEvent['name'], params: AnalyticsEvent['params'] = {}): AnalyticsEvent => ({
    id: '01J',
    name,
    occurredAt: '2026-11-18T09:00:00.000Z',
    params,
  });

  it('turns signup_step into the funnel event of the step', () => {
    expect(toEventWire(event('signup_step', { step: 'welcome' }))?.name).toBe('signup_started');
    expect(toEventWire(event('signup_step', { step: 'account_created', method: 'email' }))).toEqual({
      name: 'signup_completed',
      occurredAt: '2026-11-18T09:00:00.000Z',
      props: { source: 'email' },
    });
    expect(toEventWire(event('signup_step', { step: 'style_profile' }))?.name).toBe('onboarding_style_completed');
    expect(toEventWire(event('signup_step', { step: 'first_items', count: 5 }))).toMatchObject({
      name: 'onboarding_first_items_completed',
      props: { count: 5 },
    });
    expect(toEventWire(event('signup_step', { step: 'done' }))).toBeNull();
  });

  it('never sends events the server records itself', () => {
    expect(toEventWire(event('cart_added', { productId: 'p1' }))).toBeNull();
    expect(toEventWire(event('brand_checkout_opened'))).toBeNull();
    expect(toEventWire(event('look_shared', { channel: 'link' }))).toBeNull();
    expect(toEventWire(event('invite_install'))).toBeNull();
    expect(toEventBatchWire([event('cart_added')], 'ios', '1.0.0')).toBeNull();
  });

  it('keeps only allowed props with safe values', () => {
    const wire = toEventWire(event('paywall_viewed', { from: 'onboarding', clickId: 'x', note: 'free text here', ratio: 1.5, skipped: true }));
    expect(wire).toEqual({ name: 'paywall_viewed', occurredAt: '2026-11-18T09:00:00.000Z', props: { source: 'onboarding' } });
    expect(toEventWire(event('credits_exhausted', { feature: 'tryon' }))?.props).toEqual({ capability: 'tryon' });
    const batch = toEventBatchWire([event('paywall_viewed'), event('cart_added')], 'android', '1.2.3');
    expect(batch).toEqual({ platform: 'android', appVersion: '1.2.3', events: [{ name: 'paywall_viewed', occurredAt: '2026-11-18T09:00:00.000Z' }] });
  });
});
