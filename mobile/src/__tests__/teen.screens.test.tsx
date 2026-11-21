import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { ApiError } from '@/api/errors';
import type { TeenWire } from '@/api/wire/teen';
import { setFirebaseClientForTests, firebaseAgeGate, type FirebaseAnalyticsClient } from '@/analytics/firebase';
import { resetProductAnalyticsForTests } from '@/analytics/preference';
import { sessionStore } from '@/auth/session';
import { sharedPhotoStore } from '@/features/share/sharedPhoto';
import { teenGate } from '@/features/teen/gate';
import { teenStore } from '@/features/teen/store';
import { resetAccountFixtures } from '@/fixtures/account';
import { resetFixtureDb } from '@/fixtures/db';
import { resetStoreFixtures } from '@/fixtures/store';
import i18n from '@/i18n';

type User = { id: string; name: string; email: string; ageConfirmed: boolean; ageBand: 'adult' | 'teen' };
const mockSession: { accessToken: string; refreshToken: string; expiresAt: number; user: User } = {
  accessToken: 'a',
  refreshToken: 'r',
  expiresAt: Date.now() + 3_600_000,
  user: { id: 'u1', name: 'Ece', email: 'ece@example.com', ageConfirmed: true, ageBand: 'teen' },
};

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => JSON.stringify(mockSession)),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  AFTER_FIRST_UNLOCK: 0,
}));
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

/** The server: the teen state (`GET v1/tenant/teen`), the config, and the parent e-mail calls. */
const mockServer: { teen: TeenWire | null; band: 'adult' | 'teen'; tryOnEnabled: boolean; calls: { path: string; body?: unknown }[] } = {
  teen: null,
  band: 'teen',
  tryOnEnabled: false,
  calls: [],
};
const state = () => ({ ageBand: mockServer.band, teen: mockServer.band === 'teen' ? mockServer.teen : null });
const mockApi = jest.fn(async (path: string, opts?: { method?: string; body?: unknown }) => {
  mockServer.calls.push({ path, body: opts?.body });
  if (path === 'v1/tenant/teen') return state();
  if (path === 'v1/config')
    return { segments: { available: ['women'] }, teen: { enabled: true, tryOnEnabled: mockServer.tryOnEnabled, minimumAge: 16, adultAge: 18 } };
  if (path === 'v1/tenant/teen/parental-consent') {
    const email = (opts?.body as { parentEmail: string }).parentEmail;
    if (email === 'ece@example.com') throw new ApiError('http', 400, { status: 400, code: 'parent_email_same_as_teen' });
    mockServer.teen = {
      status: 'pendingParentalConsent',
      request: { state: 'sent', parentEmailMasked: 'a***@o***.com', resendAvailableAt: new Date(Date.now() + 42_000).toISOString() },
    };
    return state();
  }
  if (path === 'v1/tenant/teen/parental-consent/resend') return state();
  if (path === 'v1/tenant/consents' && opts?.method === 'PUT') {
    if (mockServer.teen) mockServer.teen = { ...mockServer.teen, ownTryOnConsent: true, tryOn: { available: true } };
    return { consents: [] };
  }
  if (path === 'v1/tenant/consents') return { consents: [{ type: 'teenTryOn', currentVersion: '2026-11-21' }] };
  throw new ApiError('config', null, null);
});
jest.mock('@/api/client', () => ({
  ...jest.requireActual('@/api/client'),
  apiRequest: (...args: [string, { method?: string; body?: unknown }?]) => mockApi(...args),
}));

const WAIT = { timeout: 6000 };

const PENDING: TeenWire = { status: 'pendingParentalConsent', request: { state: 'sent', parentEmailMasked: 'a***@o***.com' } };
const NONE: TeenWire = { status: 'pendingParentalConsent', request: { state: 'none' } };
const APPROVED: TeenWire = {
  status: 'active',
  request: { state: 'sent', parentEmailMasked: 'a***@o***.com' },
  parentAllowedTryOn: true,
  ownTryOnConsent: false,
};

async function open(url: string, teen: TeenWire | null, band: 'adult' | 'teen' = 'teen') {
  mockServer.teen = teen;
  mockServer.band = band;
  mockSession.user.ageBand = band;
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
  // The session store is module state: load this test's account before the first frame.
  await sessionStore.hydrate();
  await renderRouter('./src/app', { initialUrl: url });
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockServer.calls = [];
  mockServer.tryOnEnabled = false;
  teenStore.reset();
  teenGate.close();
  resetFixtureDb();
  resetStoreFixtures();
  resetAccountFixtures();
  resetProductAnalyticsForTests();
  await AsyncStorage.clear();
  await i18n.changeLanguage('en');
});

describe('limited mode (pending)', () => {
  it('Bugün shows the band; it opens 02j with what works and what waits', async () => {
    await open('/', PENDING);
    await waitFor(() => expect(screen.getByTestId('teen.banner.pending')).toBeTruthy(), WAIT);
    expect(screen.getByText('Waiting for your parent')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('teen.banner.pending'));
    await waitFor(() => expect(screen.getByTestId('teen.waiting')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('teen.waiting.body')).toHaveTextContent(/a\*\*\*@o\*\*\*\.com/);
    expect(screen.getByText('OPEN NOW')).toBeTruthy();
    expect(screen.getByText('OPENS AFTER APPROVAL')).toBeTruthy();
  });

  it('the Stylist is a calm locked state', async () => {
    await open('/stylist', PENDING);
    await waitFor(() => expect(screen.getByTestId('stylist.teenLocked')).toBeTruthy(), WAIT);
    expect(screen.getByText("Opens with your parent's approval")).toBeTruthy();
    expect(screen.getByTestId('stylist.teenLocked.action')).toHaveTextContent('See approval status');
  });

  it('declined: the band and the lock offer another parent', async () => {
    await open('/stylist', { status: 'declined', request: { state: 'sent' } });
    await waitFor(() => expect(screen.getByTestId('stylist.teenLocked.action')).toHaveTextContent('Ask another parent'), WAIT);
  });

  it('withdrawn: the band says photos were deleted', async () => {
    await open('/', { status: 'withdrawn', request: { state: 'sent' } });
    await waitFor(() => expect(screen.getByTestId('teen.banner.withdrawn')).toBeTruthy(), WAIT);
    expect(screen.getByText('Photo features are off; your photos were deleted.')).toBeTruthy();
  });
});

describe('02i / 02j — the parent e-mail', () => {
  it('a teen who never sent it lands on 02i first; own address refused; sending shows the waiting state', async () => {
    await open('/', NONE);
    await waitFor(() => expect(screen.getByTestId('teen.parent')).toBeTruthy(), WAIT);
    expect(screen).toHavePathname('/teen/parent');

    await fireEvent.press(screen.getByTestId('teen.parent.send'));
    await waitFor(() => expect(screen.getByText('Enter a valid e-mail address.')).toBeTruthy(), WAIT);

    await fireEvent.changeText(screen.getByTestId('teen.parent.email'), 'ece@example.com');
    await fireEvent.press(screen.getByTestId('teen.parent.send'));
    await waitFor(() => expect(screen.getByText("That's your own address. Enter your parent's e-mail.")).toBeTruthy(), WAIT);
    expect(mockServer.calls.some((c) => c.path === 'v1/tenant/teen/parental-consent')).toBe(false);

    await fireEvent.changeText(screen.getByTestId('teen.parent.email'), 'ayse@ornek.com');
    await fireEvent.press(screen.getByTestId('teen.parent.send'));
    await waitFor(() => expect(screen.getByTestId('teen.waiting')).toBeTruthy(), WAIT);
    expect(mockServer.calls.find((c) => c.path === 'v1/tenant/teen/parental-consent')?.body).toEqual({ parentEmail: 'ayse@ornek.com' });
    expect(screen.getByTestId('teen.waiting.resend')).toHaveTextContent(/Send the link again · 0:4\d/);

    await fireEvent.press(screen.getByTestId('teen.waiting.change'));
    await waitFor(() => expect(screen.getByTestId('teen.parent')).toBeTruthy(), WAIT);
  });

  it('an expired link says so and offers a new one', async () => {
    await open('/teen/parent', { status: 'pendingParentalConsent', request: { state: 'expired', parentEmailMasked: 'a***@o***.com' } });
    await waitFor(() => expect(screen.getByTestId('teen.waiting.expired')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('teen.waiting.resend')).toHaveTextContent('Send the link again');
  });
});

describe('hidden surfaces (every teen state)', () => {
  it('Keşfet: no search, cart or chips; the weekly edit and its looks only', async () => {
    await open('/discover', APPROVED);
    await waitFor(() => expect(screen.getByTestId('discover.teen')).toBeTruthy(), WAIT);
    for (const id of ['discover.search', 'discover.cart', 'discover.chip.shop', 'discover.chip.friends', 'discover.chip.influencer'])
      expect(screen.queryByTestId(id)).toBeNull();
    expect(screen.getByTestId('discover.teen.note')).toHaveTextContent(/weekly edit only/);
    await waitFor(() => expect(screen.getByTestId('discover.teen.looks')).toBeTruthy(), WAIT);
    expect(screen.getByText("This week's looks")).toBeTruthy();
  });

  it('Profil: no followers, @username, watch list, membership or top-up; the parent approval row', async () => {
    await open('/profile', APPROVED);
    await waitFor(() => expect(screen.getByTestId('profile.parentConsent')).toBeTruthy(), WAIT);
    await waitFor(() => expect(screen.getByText('Approved')).toBeTruthy(), WAIT);
    await waitFor(() => expect(screen.getByTestId('profile-stats')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('profile-stats')).not.toHaveTextContent(/follower/);
    expect(screen.getByText(/Teen account/)).toBeTruthy();
    for (const text of ['Watch list', 'Membership', 'Family plan', 'Follow requests', 'Followers', 'Following', 'Top up'])
      expect(screen.queryByText(text)).toBeNull();
  });

  it('Ayarlar: no closet visibility, blocked list, analytics switch, marketing or contacts consent; only the morning reminder', async () => {
    await open('/settings', APPROVED);
    await waitFor(() => expect(screen.getByTestId('settings.parentConsent')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('settings.teenAnalyticsNote')).toBeTruthy();
    expect(screen.queryByTestId('settings.productAnalytics')).toBeNull();
    expect(screen.queryByText('WHO CAN SEE MY CLOSET?')).toBeNull();
    expect(screen.queryByText('Blocked accounts')).toBeNull();
    await waitFor(() => expect(screen.getByText('Morning outfit reminder')).toBeTruthy(), WAIT);
    for (const text of ['Edit of the week', 'Friend ratings']) expect(screen.queryByText(text)).toBeNull();
    await waitFor(() => expect(screen.getByTestId('consent-list')).toBeTruthy(), WAIT);
    expect(screen.queryByTestId('consent.row.contacts')).toBeNull();
    expect(screen.queryByTestId('consent.row.marketingNotifications')).toBeNull();
    expect(screen.getByTestId('consent.row.crossBorderTransfer')).toBeTruthy();
  });

  it('Stylist (approved): no outfit-photo try-on card', async () => {
    await open('/stylist', APPROVED);
    await waitFor(() => expect(screen.getByLabelText('Stylist')).toBeTruthy(), WAIT);
    await waitFor(() => expect(screen.queryByTestId('stylist.teenLocked')).toBeNull(), WAIT);
    expect(screen.queryByText(/outfit photo/i)).toBeNull();
  });
});

describe('deep-link guards', () => {
  it.each([
    ['/shop', '/discover'],
    ['/shop/product/prod_001', '/discover'],
    ['/cart', '/discover'],
    ['/watchlist', '/discover'],
    ['/friends/feed', '/'],
    ['/friends/find', '/'],
    ['/u/damla', '/'],
    ['/paywall', '/'],
    ['/subscription', '/'],
    ['/share', '/'],
    ['/tryon/photo', '/'],
  ])('%s is closed to a teen (→ %s)', async (url, home) => {
    await open(url, APPROVED);
    await waitFor(() => expect(screen).toHavePathname(home), WAIT);
  });

  it('an adult still opens the store', async () => {
    await open('/shop', null, 'adult');
    await waitFor(() => expect(screen).toHavePathname('/shop'), WAIT);
  });

  it('a shared photo is dropped for a teen, never opening 16g', async () => {
    await sharedPhotoStore.capture({ uri: 'file:///cache/shared.jpg', width: 1000, height: 1500, receivedAt: Date.now() });
    await open('/', APPROVED);
    await waitFor(() => expect(sharedPhotoStore.get()).toBeNull(), WAIT);
    expect(screen).toHavePathname('/');
  });
});

describe('try-on for teens', () => {
  it('flag off: the look shows "Not available right now"', async () => {
    await open('/look/look_lacivert_blazer', APPROVED);
    await waitFor(() => expect(screen.getByTestId('teen.tryOnLock.unavailable')).toBeTruthy(), WAIT);
    expect(screen.getByText('Not available right now')).toBeTruthy();
    // Sharing a look is social: no share button for a teen.
    expect(screen.queryByTestId('look-share')).toBeNull();
  });

  it('parent did not tick try-on: "Opens with your parent\'s approval" + send again', async () => {
    mockServer.tryOnEnabled = true;
    await open('/look/look_lacivert_blazer', { ...APPROVED, parentAllowedTryOn: false });
    await waitFor(() => expect(screen.getByTestId('teen.tryOnLock.needsParent')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('teen.tryOnLock.resend'));
    await waitFor(() => expect(mockServer.calls.some((c) => c.path === 'v1/tenant/teen/parental-consent/resend')).toBe(true), WAIT);
  });

  it('pending: locked with the status link', async () => {
    await open('/look/look_lacivert_blazer', PENDING);
    await waitFor(() => expect(screen.getByTestId('teen.tryOnLock.limited')).toBeTruthy(), WAIT);
  });

  it('allowed: the gated action shows the 22t explainer first; accepting records the own consent', async () => {
    mockServer.tryOnEnabled = true;
    await open('/', APPROVED);
    let stopped = false;
    await act(async () => {
      stopped = teenGate.apply('explainer', () => undefined);
    });
    expect(stopped).toBe(true);
    await waitFor(() => expect(screen.getByTestId('teen.tryOnExplainer')).toBeTruthy(), WAIT);
    expect(screen.getByText("Only you see the image; it can't be shared.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId('teen.tryOnExplainer.accept'));
    await waitFor(
      () =>
        expect(
          mockServer.calls.some(
            (c) => c.path === 'v1/tenant/consents' && (c.body as { consents?: { type: string }[] })?.consents?.[0]?.type === 'teenTryOn',
          ),
        ).toBe(true),
      WAIT,
    );
  });
});

describe('notices and conversion', () => {
  it('approved after pending: the one-time "Your parent approved" screen', async () => {
    await AsyncStorage.setItem('droblet.teen.seen.u1', JSON.stringify({ band: 'teen', consent: 'pending' }));
    await open('/', APPROVED);
    await waitFor(() => expect(screen.getByTestId('teen.notice.approved')).toBeTruthy(), WAIT);
    expect(screen.getByText('Your parent approved')).toBeTruthy();
    expect(screen.getByText('Try on me: not available right now')).toBeTruthy();
  });

  it('turning 18: the account becomes a regular one and says so', async () => {
    await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
    await AsyncStorage.setItem('droblet.teen.seen.u1', JSON.stringify({ band: 'teen', consent: 'approved' }));
    await open('/', null, 'adult');
    await waitFor(() => expect(screen.getByTestId('teen.notice.adult')).toBeTruthy(), WAIT);
    expect(screen.getByText("You've turned 18, congratulations!")).toBeTruthy();
  });
});

describe('analytics off', () => {
  it('a teen session blocks Firebase (collection off, no user id)', async () => {
    const collection: boolean[] = [];
    const userIds: (string | null)[] = [];
    const client: FirebaseAnalyticsClient = {
      setCollectionEnabled: async (e) => {
        collection.push(e);
      },
      logEvent: async () => undefined,
      setUserId: async (id) => {
        userIds.push(id);
      },
      setUserProperties: async () => undefined,
    };
    setFirebaseClientForTests(client, 'unknown');
    await open('/', APPROVED);
    await waitFor(() => expect(firebaseAgeGate()).toBe('blocked'), WAIT);
    expect(collection).not.toContain(true);
    expect(collection).toContain(false);
    expect(userIds.every((id) => id === null)).toBe(true);
    setFirebaseClientForTests(undefined);
  });
});
