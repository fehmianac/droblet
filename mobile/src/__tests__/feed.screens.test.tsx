import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import * as WebBrowser from 'expo-web-browser';

import * as analytics from '@/analytics/track';
import { triedOnKey } from '@/features/credits/spendConfirm';
import { resetFeedSession } from '@/features/feed/logic';
import { storySeenStore } from '@/features/feed/storySeen';
import { resetFixtureDb } from '@/fixtures/db';
import { feedFixtureOptions, feedFixtures } from '@/fixtures/feed';
import i18n from '@/i18n';
import { seasonOf } from '@/lib/format';

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
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'dismiss' })) }));

const WAIT = { timeout: 4000 };
const SEASON = { winter: 'Winter', spring: 'Spring', summer: 'Summer', autumn: 'Autumn' }[seasonOf(new Date())];

async function openFeed(options: { triedOn?: boolean } = {}) {
  if (options.triedOn) await AsyncStorage.setItem(triedOnKey('u1'), 'yes');
  await renderRouter('./src/app', { initialUrl: '/' });
  await waitFor(() => expect(screen.getByTestId('feed.post.post_001')).toBeTruthy(), WAIT);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
  resetFixtureDb();
  resetFeedSession();
  storySeenStore.reset();
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
});

afterEach(() => jest.restoreAllMocks());

describe('Akış F1 (canvas 06″)', () => {
  it('is the first tab: header, eyebrow with the weather, title, stories and editorial posts from the fixtures', async () => {
    await openFeed({ triedOn: true });
    expect(screen.getByTestId('tab.feed').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByText('What should I wear today?')).toBeTruthy();
    expect(screen.getByLabelText("Today's plan and week")).toBeTruthy();
    // Date · temperature + city · condition (the fixture weather of Bugün).
    await waitFor(() => expect(screen.getByTestId('feed.eyebrow')).toHaveTextContent(/· 14° İSTANBUL · PARTLY CLOUDY$/), WAIT);
    // Stories: "Bugün" first, then the editor stories.
    expect(screen.getByTestId('feed.story.today')).toHaveTextContent(/Today/);
    await waitFor(() => expect(screen.getByLabelText('Droblet Edit story')).toBeTruthy(), WAIT);
    expect(screen.getByLabelText('@ornek_stilist story')).toBeTruthy();

    const post = within(screen.getByTestId('feed.post.post_001'));
    expect(post.getByText('Ofiste bordo & camel')).toBeTruthy();
    expect(post.getAllByText('Droblet Edit').length).toBeGreaterThan(0);
    expect(post.getByLabelText('Verified account')).toBeTruthy();
    expect(post.getByTestId('feed.post.post_001.meta')).toHaveTextContent(`Office · ${SEASON} · 3h`);
    expect(post.getByText('EDIT OF THE WEEK · OFFICE')).toBeTruthy();
    expect(post.getByTestId('feed.post.post_001.counter')).toHaveTextContent('1 / 4');
    expect(post.getByTestId('feed.post.post_001.buyable')).toHaveTextContent('Available to buy · 2 pieces');
    // Owned pieces say so (green); the others carry brand · price and open the product screen.
    expect(post.getByLabelText('Karamel Yün Kaban, in your wardrobe')).toBeTruthy();
    expect(post.getByLabelText(/^City Medium Siyah Çanta, Beymen Club, /)).toBeTruthy();
    expect(post.getByTestId('feed.post.post_001.tryOn').props.accessibilityLabel).toBe('Try it on me · 1 credit');
    expect(post.getByTestId('feed.post.post_001.buy')).toBeTruthy();
    expect(post.getByTestId('feed.post.post_001.likes')).toHaveTextContent('1,284 likes');
    // A stylist post without products is the compact card: the try-on pill on the photo, no buy button.
    const compact = within(screen.getByTestId('feed.post.post_002'));
    expect(compact.getByTestId('feed.post.post_002.meta')).toHaveTextContent('Selected stylist · Weekend · 5h');
    expect(compact.getByLabelText('Try this look on me, 1 credit')).toBeTruthy();
    expect(compact.queryByTestId('feed.post.post_002.buy')).toBeNull();
    // Nothing of what F1 leaves out.
    expect(screen.queryByText(/comment/i)).toBeNull();
    expect(screen.queryByLabelText(/share/i)).toBeNull();
    expect(screen.queryByText(/follow/i)).toBeNull();
    // Only users who never tried on see "İlk adım".
    expect(screen.queryByTestId('feed.firstStep')).toBeNull();
  });

  it('shows "İlk look\'unu dene" to a user who never tried anything on', async () => {
    await openFeed();
    await waitFor(() => expect(screen.getByTestId('feed.firstStep')).toBeTruthy(), WAIT);
    expect(screen.getByText('FIRST STEP')).toBeTruthy();
    expect(screen.getByText('Try your first look')).toBeTruthy();
  });

  it('filters with the occasion tabs; a single page ends with "Hepsi bu kadar"', async () => {
    await openFeed({ triedOn: true });
    expect(screen.getByTestId('feed.tab.all').props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByTestId('feed.tab.invite'));
    await waitFor(() => expect(screen.getByText('Davette saten')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('feed.tab.invite').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.queryByText('Ofiste bordo & camel')).toBeNull();
    expect(screen.getByTestId('feed.post.post_003.meta')).toHaveTextContent(/^Invitation · /);
    expect(screen.getByTestId('feed.end')).toHaveTextContent("That's all. New ideas tomorrow morning.");

    await fireEvent.press(screen.getByTestId('feed.tab.office'));
    await waitFor(() => expect(screen.getByText('Ofiste bordo & camel')).toBeTruthy(), WAIT);
    expect(screen.queryByText('Davette saten')).toBeNull();
  });

  it('the first page of "Tümü" has more to load: no end text yet', async () => {
    await openFeed({ triedOn: true });
    expect(screen.queryByTestId('feed.end')).toBeNull();
    expect(feedFixtures.page('all', null).nextPageToken).toBe('10');
  });

  it('likes and saves optimistically, and the writes reach the server', async () => {
    const track = jest.spyOn(analytics, 'track');
    await openFeed({ triedOn: true });
    await fireEvent.press(screen.getByTestId('feed.post.post_001.like'));
    // Optimistic: the heart and the count change from the cache, without a refetch of the feed.
    await waitFor(() => expect(screen.getByTestId('feed.post.post_001.like').props.accessibilityState).toMatchObject({ selected: true }), WAIT);
    expect(screen.getByTestId('feed.post.post_001.likes')).toHaveTextContent('1,285 likes');
    await waitFor(() => expect(feedFixtures.page('all', null).items[0]?.liked).toBe(true), WAIT);
    expect(track).toHaveBeenCalledWith('feed_like', { postId: 'post_001', liked: true });

    await fireEvent.press(screen.getByTestId('feed.post.post_001.save'));
    await waitFor(() => expect(screen.getByTestId('feed.post.post_001.save').props.accessibilityState).toMatchObject({ selected: true }), WAIT);
    await waitFor(() => expect(screen.getByTestId('toast-feed-save')).toBeTruthy(), WAIT);
    await waitFor(() => expect(feedFixtures.saved().map((p) => p.id)).toEqual(['post_001']), WAIT);
    expect(track).toHaveBeenCalledWith('feed_save', { postId: 'post_001', saved: true });

    // Unlike goes back down.
    await fireEvent.press(screen.getByTestId('feed.post.post_001.like'));
    await waitFor(() => expect(screen.getByTestId('feed.post.post_001.likes')).toHaveTextContent('1,284 likes'), WAIT);
    await waitFor(() => expect(feedFixtures.page('all', null).items[0]?.liked).toBe(false), WAIT);
  });

  it('opens the story viewer from the row; the ring turns to "seen"', async () => {
    const track = jest.spyOn(analytics, 'track');
    await openFeed({ triedOn: true });
    await waitFor(() => expect(screen.getByTestId('feed.story.story_001')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('feed.story.story_001'));
    await waitFor(() => expect(screen.getByTestId('feed.storyViewer')).toBeTruthy(), WAIT);
    expect(screen).toHavePathname('/feed/story');
    expect(screen.getByText('Ofiste bordo & camel')).toBeTruthy();
    expect(screen.getByText('DE')).toBeTruthy();
    expect(screen.getByLabelText('Story 1 of 3')).toBeTruthy();
    expect(screen.getByTestId('feed.story.product')).toHaveTextContent(/City Medium Siyah Çanta/);
    expect(screen.getByTestId('feed.story.buy')).toBeTruthy();
    expect(screen.getByTestId('feed.story.tryOn').props.accessibilityLabel).toBe('Try it on me · 1 credit');
    expect(track).toHaveBeenCalledWith('feed_story_view', { storyId: 'story_001' });

    // Next story by tapping the right side.
    await fireEvent.press(screen.getByTestId('feed.story.next'));
    await waitFor(() => expect(screen.getByText('Hafta sonuna krem tonlar')).toBeTruthy(), WAIT);
    expect(screen.getByLabelText('Story 2 of 3')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('feed.story.close'));
    await waitFor(() => expect(screen.getByLabelText('Droblet Edit story, seen')).toBeTruthy(), WAIT);
    expect(screen.getByLabelText('@ornek_stilist story, seen')).toBeTruthy();
  });

  it('"Satın al" opens "Look\'taki ürünler"; a product opens on its brand site', async () => {
    const track = jest.spyOn(analytics, 'track');
    await openFeed({ triedOn: true });
    await fireEvent.press(screen.getByTestId('feed.post.post_001.buy'));
    await waitFor(() => expect(screen.getByTestId('feed.buySheet')).toBeTruthy(), WAIT);
    expect(screen.getByText('Products in the look')).toBeTruthy();
    expect(screen.getByText('AVAILABLE TO BUY · 2')).toBeTruthy();
    expect(screen.getByText('IN YOUR WARDROBE')).toBeTruthy();
    expect(screen.getByTestId('feed.buy.prod_004')).toBeTruthy();
    expect(screen.getByTestId('feed.buy.prod_015')).toBeTruthy();
    // Owned pieces are not offered for sale.
    expect(screen.queryByTestId('feed.buy.prod_011')).toBeNull();
    expect(screen.getByTestId('feed.owned.prod_011')).toBeTruthy();
    expect(screen.getByText(/Sale, payment and delivery are with the brand/)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('feed.buy.open.prod_004'));
    await waitFor(() => expect(WebBrowser.openBrowserAsync).toHaveBeenCalled(), WAIT);
    expect((WebBrowser.openBrowserAsync as jest.Mock).mock.calls[0]?.[0]).toMatch(/^https:\/\/example\.com\/checkout\/prod_004/);
    expect(track).toHaveBeenCalledWith('feed_buy_click', expect.objectContaining({ productId: 'prod_004', source: 'post', postId: 'post_001' }));
  });

  it('a piece opens the existing product screen', async () => {
    await openFeed({ triedOn: true });
    await fireEvent.press(screen.getByTestId('feed.piece.prod_004'));
    await waitFor(() => expect(screen).toHavePathname('/shop/product/prod_004'), WAIT);
  });

  it('"Üzerimde dene" starts the shared try-on flow for the post', async () => {
    const track = jest.spyOn(analytics, 'track');
    await openFeed({ triedOn: true });
    await fireEvent.press(screen.getByTestId('feed.post.post_001.tryOn'));
    expect(track).toHaveBeenCalledWith('feed_tryon_start', { source: 'post', postId: 'post_001' });
  });

  it('the calendar icon and the "Bugün" story open 06 Bugün at /today', async () => {
    await openFeed({ triedOn: true });
    await fireEvent.press(screen.getByTestId('feed.plan'));
    await waitFor(() => expect(screen).toHavePathname('/today'), WAIT);
    await waitFor(() => expect(screen.getByText('Lacivert Blazer')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('today.back'));
    await waitFor(() => expect(screen).toHavePathname('/'), WAIT);
    await fireEvent.press(screen.getByTestId('feed.story.today'));
    await waitFor(() => expect(screen).toHavePathname('/today'), WAIT);
  });

  it('a failed read shows the error state with "Try again"', async () => {
    feedFixtureOptions.failNextRead();
    await renderRouter('./src/app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('state-error')).toBeTruthy(), WAIT);
    expect(screen.getByText("The feed couldn't load")).toBeTruthy();
    await fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => expect(screen.getByTestId('feed.post.post_001')).toBeTruthy(), WAIT);
  });

  it('an empty filter offers "Tümü"', async () => {
    feedFixtureOptions.setPosts(feedFixtures.page('all', null).items.filter((p) => p.occasion !== 'dinner'));
    await openFeed({ triedOn: true });
    await fireEvent.press(screen.getByTestId('feed.tab.invite'));
    await waitFor(() => expect(screen.getByTestId('state-empty')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByText('See all'));
    await waitFor(() => expect(screen.getByText('Ofiste bordo & camel')).toBeTruthy(), WAIT);
  });
});

describe('Kaydedilenler › Akış', () => {
  it('lists the saved feed posts; "Kaydet" again removes one', async () => {
    feedFixtures.save('post_003', true);
    await renderRouter('./src/app', { initialUrl: '/friends/saved?tab=feed' });
    await waitFor(() => expect(screen.getByTestId('feed.post.post_003')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('saved.tab.feed').props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByTestId('feed.post.post_003.save'));
    await waitFor(() => expect(screen.queryByTestId('feed.post.post_003')).toBeNull(), WAIT);
    await waitFor(() => expect(feedFixtures.saved()).toEqual([]), WAIT);
  });
});
