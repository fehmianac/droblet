import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import * as analytics from '@/analytics/track';
import { triedOnKey } from '@/features/credits/spendConfirm';
import { resetFeedSession } from '@/features/feed/logic';
import { storySeenStore } from '@/features/feed/storySeen';
import { feedShareConfirmedKey } from '@/features/looks/feedShareConfirm';
import { accountFixtures, resetAccountFixtures } from '@/fixtures/account';
import { fixtureDb, resetFixtureDb } from '@/fixtures/db';
import { feedFixtureOptions, feedFixtures } from '@/fixtures/feed';
import { feedShareFixtureOptions } from '@/fixtures/looks';
import i18n from '@/i18n';
import { toIsoDate } from '@/lib/format';

const mockSession = {
  accessToken: 'a',
  refreshToken: 'r',
  expiresAt: Date.now() + 3_600_000,
  user: { id: 'u1', name: 'Damla', email: 'damla@example.com' },
};

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => JSON.stringify(mockSession)),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  AFTER_FIRST_UNLOCK: 0,
}));
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));

/** A teen account for the surfaces under test (the teen flows themselves are covered by teen.screens.test). */
let mockTeen = false;
jest.mock('@/features/teen/store', () => {
  const actual = jest.requireActual('@/features/teen/store');
  const asTeen = <T extends { hide: Record<string, boolean> }>(rules: T): T => (mockTeen ? { ...rules, isTeen: true, hide: { ...rules.hide, commerce: true, marketing: true } } : rules);
  return { ...actual, useTeenRules: () => asTeen(actual.useTeenRules()), currentTeenRules: () => asTeen(actual.currentTeenRules()) };
});

const WAIT = { timeout: 5000 };
const LOOK = 'look_lacivert_blazer';
const SHARED_LOOK = 'look_siyah_duz_elbise';
const USER_POST = 'upost_001';

const look = (id: string) => fixtureDb.looks.find((l) => l.id === id);

async function openLook(id: string = LOOK) {
  await renderRouter('./src/app', { initialUrl: `/look/${id}` });
  await waitFor(() => expect(screen.getByTestId('look-try-on')).toBeTruthy(), WAIT);
}

async function openFeed() {
  await AsyncStorage.setItem(triedOnKey('u1'), 'yes');
  await renderRouter('./src/app', { initialUrl: '/' });
  await waitFor(() => expect(screen.getByTestId('feed.post.post_001')).toBeTruthy(), WAIT);
}

const shareSwitch = () => screen.getByTestId('look-feed-share-switch');

beforeEach(async () => {
  mockTeen = false;
  await AsyncStorage.clear();
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
  resetFixtureDb();
  resetAccountFixtures();
  resetFeedSession();
  storySeenStore.reset();
  feedShareFixtureOptions.failNext = null;
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
});

afterEach(() => jest.restoreAllMocks());

describe('14b Look detail · "Akışta paylaş" (Akış F2)', () => {
  it('is off by default; the first share asks once, then the look is live under the @handle', async () => {
    const track = jest.spyOn(analytics, 'track');
    await openLook();
    await waitFor(() => expect(shareSwitch().props.accessibilityState).toMatchObject({ checked: false, disabled: false }), WAIT);
    expect(screen.getByText('Share to the feed')).toBeTruthy();
    expect(screen.getByTestId('look-feed-share-hint')).toHaveTextContent('Anyone can see, like and save it.');
    expect(screen.queryByTestId('look-feed-share-stats')).toBeNull();

    // First share on this phone: the sheet with its four sentences.
    await fireEvent.press(shareSwitch());
    await waitFor(() => expect(screen.getByTestId('look-feed-share-sheet')).toBeTruthy(), WAIT);
    expect(screen.getByText('Share your look to the feed')).toBeTruthy();
    expect(screen.getByText('Anyone can see this look, its cover and the pictures of its pieces.')).toBeTruthy();
    expect(screen.getByText('It shows under your name @damla; people can like and save it.')).toBeTruthy();
    expect(screen.getByText('Your body and face photos and your try-on images are never shared.')).toBeTruthy();
    expect(screen.getByText('You can switch it off any time; the look leaves the feed.')).toBeTruthy();

    // "Şimdi değil": nothing is shared, and the sheet comes again next time.
    await fireEvent.press(screen.getByTestId('look-feed-share-cancel'));
    await waitFor(() => expect(screen.queryByTestId('look-feed-share-sheet')).toBeNull(), WAIT);
    expect(shareSwitch().props.accessibilityState).toMatchObject({ checked: false });
    expect(look(LOOK)?.sharedToFeed).toBeFalsy();
    expect(await AsyncStorage.getItem(feedShareConfirmedKey('u1'))).toBeNull();

    await fireEvent.press(shareSwitch());
    await waitFor(() => expect(screen.getByTestId('look-feed-share-accept')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('look-feed-share-accept'));
    await waitFor(() => expect(shareSwitch().props.accessibilityState).toMatchObject({ checked: true }), WAIT);
    expect(screen.getByTestId('look-feed-share-hint')).toHaveTextContent('Live on the feed · as @damla. Switch it off to take it down.');
    expect(screen.getByTestId('look-feed-share-stats')).toHaveTextContent('0 likes · 0 people saved it');
    await waitFor(() => expect(look(LOOK)?.sharedToFeed).toBe(true), WAIT);
    expect(track).toHaveBeenCalledWith('feed_share_on', { lookId: LOOK, first: true });
    await waitFor(async () => expect(await AsyncStorage.getItem(feedShareConfirmedKey('u1'))).toBe('1'), WAIT);

    // Off is immediate: no confirmation, a toast.
    await fireEvent.press(shareSwitch());
    await waitFor(() => expect(shareSwitch().props.accessibilityState).toMatchObject({ checked: false }), WAIT);
    expect(screen.getByTestId('toast-feed-share-off')).toHaveTextContent('Removed from the feed');
    expect(screen.queryByTestId('look-feed-share-stats')).toBeNull();
    await waitFor(() => expect(look(LOOK)?.sharedToFeed).toBe(false), WAIT);
    expect(track).toHaveBeenCalledWith('feed_share_off', { lookId: LOOK });

    // Later shares go straight through.
    await fireEvent.press(shareSwitch());
    await waitFor(() => expect(shareSwitch().props.accessibilityState).toMatchObject({ checked: true }), WAIT);
    expect(screen.queryByTestId('look-feed-share-sheet')).toBeNull();
    await waitFor(() => expect(look(LOOK)?.sharedToFeed).toBe(true), WAIT);
    expect(track).toHaveBeenCalledWith('feed_share_on', { lookId: LOOK, first: false });
  });

  it('a shared look shows what it got on the feed', async () => {
    await openLook(SHARED_LOOK);
    await waitFor(() => expect(shareSwitch().props.accessibilityState).toMatchObject({ checked: true }), WAIT);
    expect(screen.getByTestId('look-feed-share-stats')).toHaveTextContent('38 likes · 12 people saved it');
  });

  it('is not drawn for a teen account', async () => {
    mockTeen = true;
    await openLook();
    expect(screen.queryByTestId('look-feed-share')).toBeNull();
    expect(screen.queryByText('Share to the feed')).toBeNull();
  });

  it('is not drawn for an imported look', async () => {
    const imported = look(LOOK);
    if (imported) imported.imported = true;
    await openLook();
    expect(screen.queryByTestId('look-feed-share')).toBeNull();
  });

  it('an unverified e-mail leads to the verify screen; the switch stays off', async () => {
    resetAccountFixtures({ emailVerified: false });
    await openLook();
    await waitFor(() => expect(shareSwitch().props.accessibilityState).toMatchObject({ disabled: false }), WAIT);
    await fireEvent.press(shareSwitch());
    await waitFor(() => expect(screen).toHavePathname('/verify-email'), WAIT);
    expect(screen.getByTestId('toast-feed-share-verify')).toHaveTextContent('Verify your e-mail first to share to the feed.');
    expect(look(LOOK)?.sharedToFeed).toBeFalsy();
  });

  it('without an @handle the handle step comes first, then the confirmation and the share', async () => {
    resetAccountFixtures({ handle: null });
    await openLook();
    await waitFor(() => expect(shareSwitch().props.accessibilityState).toMatchObject({ disabled: false }), WAIT);
    await fireEvent.press(shareSwitch());
    await waitFor(() => expect(screen.getByTestId('requirements.step.handle')).toBeTruthy(), WAIT);
    expect(look(LOOK)?.sharedToFeed).toBeFalsy();
    await fireEvent.changeText(screen.getByTestId('requirements.handle.input'), 'damla_k');
    await waitFor(() => expect(screen.getByTestId('requirements.handle.save')).not.toBeDisabled(), WAIT);
    await fireEvent.press(screen.getByTestId('requirements.handle.save'));
    await waitFor(() => expect(accountFixtures.profile().handle).toBe('damla_k'), WAIT);
    // Back where the user left off: the first-share sheet, naming the new handle.
    await waitFor(() => expect(screen.getByTestId('look-feed-share-sheet')).toBeTruthy(), WAIT);
    await waitFor(() => expect(screen.getByText('It shows under your name @damla_k; people can like and save it.')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('look-feed-share-accept'));
    await waitFor(() => expect(look(LOOK)?.sharedToFeed).toBe(true), WAIT);
  });

  it.each([
    ['look_not_shareable', 422, "This look can't be shared to the feed right now."],
    ['email_not_verified', 422, 'Verify your e-mail first to share.'],
    ['handle_required', 422, 'Pick a username first to share.'],
    ['teen_restricted', 403, 'Sharing to the feed is off for teen accounts.'],
  ])('a server refusal (%s) rolls the switch back with a calm sentence', async (code, status, sentence) => {
    await AsyncStorage.setItem(feedShareConfirmedKey('u1'), '1');
    feedShareFixtureOptions.failNext = { status, code };
    await openLook();
    await waitFor(() => expect(shareSwitch().props.accessibilityState).toMatchObject({ disabled: false }), WAIT);
    await fireEvent.press(shareSwitch());
    await waitFor(() => expect(screen.getByTestId('toast-feed-share-error')).toHaveTextContent(sentence), WAIT);
    await waitFor(() => expect(shareSwitch().props.accessibilityState).toMatchObject({ checked: false }), WAIT);
    expect(look(LOOK)?.sharedToFeed).toBeFalsy();
  });
});

describe("Akış F2 · a member's look on the feed", () => {
  it('draws the community card: @handle, meta, cover, name, pieces, ♡ and Kaydet — no try-on, no buying, no verified mark', async () => {
    await openFeed();
    const post = within(screen.getByTestId(`feed.post.${USER_POST}`));
    expect(screen.getByLabelText('Community: @ornek_kullanici, Desenli kazak')).toBeTruthy();
    expect(post.getByText('@ornek_kullanici')).toBeTruthy();
    expect(post.getByTestId(`feed.post.${USER_POST}.meta`)).toHaveTextContent('Community · Weekend · 1h');
    expect(post.getByText('Desenli kazak')).toBeTruthy();
    expect(post.getByLabelText('Desenli kazak, look cover')).toBeTruthy();
    // The piece strip: picture + kind, nothing to tap.
    const strip = within(post.getByTestId(`feed.post.${USER_POST}.pieces`));
    for (const kind of ['Top', 'Bottom', 'Shoes', 'Bag']) expect(strip.getByLabelText(kind)).toBeTruthy();
    expect(strip.queryAllByRole('link')).toHaveLength(0);
    expect(strip.queryAllByRole('button')).toHaveLength(0);
    expect(post.getByTestId(`feed.post.${USER_POST}.likes`)).toHaveTextContent('38 likes');
    expect(post.getByTestId(`feed.post.${USER_POST}.like`)).toBeTruthy();
    expect(post.getByTestId(`feed.post.${USER_POST}.save`)).toBeTruthy();
    expect(post.getByLabelText('Post options')).toBeTruthy();
    // What a member's look never has.
    expect(post.queryByTestId(`feed.post.${USER_POST}.tryOn`)).toBeNull();
    expect(post.queryByText(/Try it on me/)).toBeNull();
    expect(post.queryByTestId(`feed.post.${USER_POST}.buy`)).toBeNull();
    expect(post.queryByTestId(`feed.post.${USER_POST}.buyable`)).toBeNull();
    expect(post.queryByLabelText('Verified account')).toBeNull();
    expect(post.queryByTestId(`feed.post.${USER_POST}.counter`)).toBeNull();
    // Editor posts have no "⋯".
    expect(within(screen.getByTestId('feed.post.post_001')).queryByLabelText('Post options')).toBeNull();
  });

  it('likes and saves like any post', async () => {
    await openFeed();
    await fireEvent.press(screen.getByTestId(`feed.post.${USER_POST}.like`));
    await waitFor(() => expect(screen.getByTestId(`feed.post.${USER_POST}.likes`)).toHaveTextContent('39 likes'), WAIT);
    await fireEvent.press(screen.getByTestId(`feed.post.${USER_POST}.save`));
    await waitFor(() => expect(feedFixtures.saved().map((p) => p.id)).toEqual([USER_POST]), WAIT);
  });

  it('the author opens the profile', async () => {
    await openFeed();
    await fireEvent.press(screen.getByTestId(`feed.post.${USER_POST}.author`));
    await waitFor(() => expect(screen).toHavePathname('/u/ornek_kullanici'), WAIT);
  });

  it('"Benzerlerini gör" lists the similar products; one opens the product screen', async () => {
    const track = jest.spyOn(analytics, 'track');
    await openFeed();
    await fireEvent.press(screen.getByTestId(`feed.post.${USER_POST}.similar`));
    expect(track).toHaveBeenCalledWith('feed_similar_open', { postId: USER_POST });
    await waitFor(() => expect(screen.getByTestId('feed.similar.prod_022')).toBeTruthy(), WAIT);
    expect(screen.getByText('Similar products')).toBeTruthy();
    expect(screen.getByText('Desenli kazak · @ornek_kullanici')).toBeTruthy();
    expect(screen.getByTestId('feed.similar.prod_020')).toBeTruthy();
    expect(screen.getByTestId('feed.similar.prod_015')).toBeTruthy();
    // Name, brand and price on each row.
    expect(screen.getByTestId('feed.similar.prod_015').props.accessibilityLabel).toMatch(/^.+, .+, .*\d/);
    await fireEvent.press(screen.getByTestId('feed.similar.prod_022'));
    await waitFor(() => expect(screen).toHavePathname('/shop/product/prod_022'), WAIT);
  });

  it('shows "Benzerlerini gör" only when the catalogue has something close', async () => {
    feedFixtureOptions.setPosts(feedFixtures.page('all', null).items.map((p) => (p.id === USER_POST ? { ...p, hasSimilar: false } : p)));
    await openFeed();
    expect(screen.getByTestId(`feed.post.${USER_POST}`)).toBeTruthy();
    expect(screen.queryByTestId(`feed.post.${USER_POST}.similar`)).toBeNull();
  });

  it('"⋯" › "Bunu gösterme" takes the post out at once and tells the server', async () => {
    const track = jest.spyOn(analytics, 'track');
    await openFeed();
    await fireEvent.press(screen.getByTestId(`feed.post.${USER_POST}.menu`));
    await waitFor(() => expect(screen.getByTestId('feed.postMenu')).toBeTruthy(), WAIT);
    expect(screen.getByText('@ornek_kullanici · Desenli kazak')).toBeTruthy();
    expect(screen.getByText("Don't show this")).toBeTruthy();
    expect(screen.getByText('Report')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('feed.postMenu.hide'));
    await waitFor(() => expect(screen.queryByTestId(`feed.post.${USER_POST}`)).toBeNull(), WAIT);
    expect(screen.getByTestId('toast-feed-hide')).toHaveTextContent("You won't see this post again");
    // No undo.
    expect(within(screen.getByTestId('toast-feed-hide')).queryByRole('button')).toBeNull();
    await waitFor(() => expect(feedFixtures.hiddenIds()).toEqual([USER_POST]), WAIT);
    expect(track).toHaveBeenCalledWith('feed_hide', { postId: USER_POST });
    expect(screen.getByTestId('feed.post.post_001')).toBeTruthy();
  });

  it('"⋯" › "Vazgeç" closes the menu and keeps the post', async () => {
    await openFeed();
    await fireEvent.press(screen.getByTestId(`feed.post.${USER_POST}.menu`));
    await waitFor(() => expect(screen.getByTestId('feed.postMenu.cancel')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('feed.postMenu.cancel'));
    await waitFor(() => expect(screen.queryByTestId('feed.postMenu')).toBeNull(), WAIT);
    expect(screen.getByTestId(`feed.post.${USER_POST}`)).toBeTruthy();
    expect(feedFixtures.hiddenIds()).toEqual([]);
  });

  it('"⋯" › "Şikâyet et" asks for the reason, sends the report and hides the post', async () => {
    const track = jest.spyOn(analytics, 'track');
    await openFeed();
    await fireEvent.press(screen.getByTestId(`feed.post.${USER_POST}.menu`));
    await waitFor(() => expect(screen.getByTestId('feed.postMenu.report')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('feed.postMenu.report'));
    await waitFor(() => expect(screen.getByTestId('feed.report')).toBeTruthy(), WAIT);
    expect(screen.getByText('Report this post')).toBeTruthy();
    // The reasons of the existing report flow.
    expect(screen.getByRole('radio', { name: 'Inappropriate content' })).toBeChecked();
    await fireEvent.press(screen.getByRole('radio', { name: 'Spam' }));
    await fireEvent.press(screen.getByTestId('feed.report.submit'));
    await waitFor(() => expect(screen.queryByTestId(`feed.post.${USER_POST}`)).toBeNull(), WAIT);
    expect(screen.getByTestId('toast-feed-report')).toHaveTextContent('We got your report');
    await waitFor(() => expect(feedFixtures.reports()).toEqual([{ postId: USER_POST, reason: 'spam', note: null }]), WAIT);
    expect(track).toHaveBeenCalledWith('feed_report', { postId: USER_POST, reason: 'spam' });
  });

  it('a teen account gets editor posts only', async () => {
    mockTeen = true;
    await openFeed();
    expect(screen.queryByTestId(`feed.post.${USER_POST}`)).toBeNull();
    expect(screen.queryByLabelText('Post options')).toBeNull();
  });
});

describe('Kaydedilenler › Akış with a member\'s look', () => {
  it('shows the saved member post with the same card; "⋯" works there too', async () => {
    feedFixtures.save(USER_POST, true);
    feedFixtures.save('post_003', true);
    await renderRouter('./src/app', { initialUrl: '/friends/saved?tab=feed' });
    await waitFor(() => expect(screen.getByTestId(`feed.post.${USER_POST}`)).toBeTruthy(), WAIT);
    const post = within(screen.getByTestId(`feed.post.${USER_POST}`));
    expect(post.getByTestId(`feed.post.${USER_POST}.meta`)).toHaveTextContent('Community · Weekend · 1h');
    expect(post.getByTestId(`feed.post.${USER_POST}.pieces`)).toBeTruthy();
    expect(post.getByTestId(`feed.post.${USER_POST}.similar`)).toBeTruthy();
    expect(post.queryByTestId(`feed.post.${USER_POST}.tryOn`)).toBeNull();
    expect(post.getByTestId(`feed.post.${USER_POST}.save`).props.accessibilityState).toMatchObject({ selected: true });

    await fireEvent.press(screen.getByTestId(`feed.post.${USER_POST}.menu`));
    await waitFor(() => expect(screen.getByTestId('feed.postMenu.hide')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('feed.postMenu.hide'));
    await waitFor(() => expect(screen.queryByTestId(`feed.post.${USER_POST}`)).toBeNull(), WAIT);
    expect(screen.getByTestId('feed.post.post_003')).toBeTruthy();
    await waitFor(() => expect(feedFixtures.saved().map((p) => p.id)).toEqual(['post_003']), WAIT);
  });
});

describe('Akış · "Kendi parçalarımla kur" on an editor post', () => {
  it('shows with two matched wardrobe pieces and opens the builder with them and the occasion preselected', async () => {
    const track = jest.spyOn(analytics, 'track');
    await openFeed();
    const button = screen.getByTestId('feed.post.post_001.buildWithMine');
    expect(button).toHaveTextContent('Build it with my pieces');
    expect(button.props.accessibilityLabel).toBe('Build it with my pieces, 2 pieces from your wardrobe');
    await fireEvent.press(button);
    expect(track).toHaveBeenCalledWith('feed_build_with_mine', { postId: 'post_001', count: 2 });
    await waitFor(() => expect(screen).toHavePathname('/look/new'), WAIT);
    await waitFor(() => expect(screen.getByText('2 PIECES SELECTED')).toBeTruthy(), WAIT);
    const trench = fixtureDb.items.find((i) => i.id === 'item_beige_trench');
    const knit = fixtureDb.items.find((i) => i.id === 'item_cream_knit');
    expect(screen.getByText(trench?.name ?? '-')).toBeTruthy();
    expect(screen.getByText(knit?.name ?? '-')).toBeTruthy();
    expect(screen.getByTestId('look-save')).toBeEnabled();
  });

  it('is hidden with fewer than two matches, and on a member\'s post', async () => {
    feedFixtureOptions.setPosts(
      feedFixtures.page('all', null).items.map((p) =>
        p.id === 'post_001' ? { ...p, products: p.products.map((prod, i) => (i === 0 ? prod : { ...prod, ownedItemId: null })) } : p,
      ),
    );
    await openFeed();
    expect(screen.queryByTestId('feed.post.post_001.buildWithMine')).toBeNull();
    expect(screen.queryByTestId(`feed.post.${USER_POST}.buildWithMine`)).toBeNull();
    // Owned without a known wardrobe item (older server): no button either.
    expect(screen.queryByTestId('feed.post.post_003.buildWithMine')).toBeNull();
  });
});

describe('Akış · "Bugün için plan yok"', () => {
  it('offers "Look seç" when today has no look; picking one plans today and the row becomes the look', async () => {
    const today = toIsoDate(new Date());
    fixtureDb.planDays = fixtureDb.planDays.filter((p) => p.date !== today);
    await openFeed();
    await waitFor(() => expect(screen.getByTestId('feed.todayEmpty')).toBeTruthy(), WAIT);
    expect(screen.getByText('Nothing planned for today')).toBeTruthy();
    expect(screen.queryByTestId('feed.todayCard')).toBeNull();
    await fireEvent.press(screen.getByTestId('feed.todayEmpty.pick'));
    await waitFor(() => expect(screen.getByText('Pick a look for this day')).toBeTruthy(), WAIT);
    await waitFor(() => expect(screen.getByTestId('planPick.look.look_tuvit_jean')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('planPick.look.look_tuvit_jean'));
    await waitFor(() => expect(fixtureDb.planDays.find((p) => p.date === today)?.lookId).toBe('look_tuvit_jean'), WAIT);
    await waitFor(() => expect(screen.getByTestId('feed.todayCard')).toBeTruthy(), WAIT);
    expect(screen.queryByTestId('feed.todayEmpty')).toBeNull();
  });

  it('the row itself opens Bugün', async () => {
    const today = toIsoDate(new Date());
    fixtureDb.planDays = fixtureDb.planDays.filter((p) => p.date !== today);
    await openFeed();
    await waitFor(() => expect(screen.getByTestId('feed.todayEmpty.open')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('feed.todayEmpty.open'));
    await waitFor(() => expect(screen).toHavePathname('/today'), WAIT);
  });
});

describe('Ayarlar › Bildirimler · look likes digest', () => {
  it('is on by default and can be switched off', async () => {
    await renderRouter('./src/app', { initialUrl: '/settings' });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Look likes (daily summary)' })).toBeChecked(), WAIT);
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Look likes (daily summary)' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Look likes (daily summary)' })).not.toBeChecked(), WAIT);
    await waitFor(() => expect(accountFixtures.notifications().feedLikesDigest).toBe(false), WAIT);
  });

  it('is not offered to a teen account', async () => {
    mockTeen = true;
    await renderRouter('./src/app', { initialUrl: '/settings' });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Morning outfit reminder' })).toBeTruthy(), WAIT);
    expect(screen.queryByRole('checkbox', { name: 'Look likes (daily summary)' })).toBeNull();
  });
});
