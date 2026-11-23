import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import * as analytics from '@/analytics/track';
import { toFeedPiece } from '@/api/wire/feed';
import { triedOnKey } from '@/features/credits/spendConfirm';
import { pieceName, resetFeedSession } from '@/features/feed/logic';
import { storySeenStore } from '@/features/feed/storySeen';
import { resetAccountFixtures } from '@/fixtures/account';
import { resetFixtureDb } from '@/fixtures/db';
import { feedFixtureOptions, feedFixtures } from '@/fixtures/feed';
import i18n from '@/i18n';

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
/** Editor post with catalogue products (two of them "in your wardrobe"). */
const PRODUCTS = 'post_001';
/** Editor photograph without products: "Jean ve trençkot" — trench coat, jeans, and shoes without a sub-type. */
const PHOTO = 'post_005';
/** A member's look: top, bottom, shoes, bag; the catalogue has similar products. */
const USER_POST = 'upost_001';

type Post = ReturnType<typeof feedFixtures.page>['items'][number];

/** Akış with the three posts under test (optionally changed). */
async function openFeed(change?: (posts: Record<string, Post>) => void) {
  const all = feedFixtures.page('all', null).items;
  const byId = Object.fromEntries([PRODUCTS, USER_POST, PHOTO].map((id) => [id, all.find((p) => p.id === id)!]));
  change?.(byId);
  feedFixtureOptions.setPosts(Object.values(byId));
  await AsyncStorage.setItem(triedOnKey('u1'), 'yes');
  await renderRouter('./src/app', { initialUrl: '/' });
  await waitFor(() => expect(screen.getByTestId(`feed.post.${PHOTO}`)).toBeTruthy(), WAIT);
}

async function openDetail(id: string, by: 'photo.0' | 'title' = 'photo.0') {
  await fireEvent.press(screen.getByTestId(`feed.post.${id}.${by}`));
  await waitFor(() => expect(screen.getByTestId('feed.detail')).toBeTruthy(), WAIT);
  expect(screen).toHavePathname(`/feed/${id}`);
}

beforeEach(async () => {
  mockTeen = false;
  await AsyncStorage.clear();
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
  resetFixtureDb();
  resetAccountFixtures();
  resetFeedSession();
  storySeenStore.reset();
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
});

afterEach(() => jest.restoreAllMocks());

describe('Akış · post detail (owner request 2026-11-23)', () => {
  it('the photograph of an editor post with pieces opens its detail: author, photos, eyebrow, title, note, the piece grid', async () => {
    const track = jest.spyOn(analytics, 'track');
    await openFeed((posts) => {
      // The first piece has a picture: it can be enlarged; the others draw their glyph.
      posts[PHOTO]!.pieces = posts[PHOTO]!.pieces.map((p, i) => (i === 0 ? { ...p, imageUrl: 'https://cdn.example.com/piece-1.png' } : p));
    });
    expect(screen.getByTestId(`feed.post.${PHOTO}.photo.0`).props.accessibilityLabel).toBe('Open the details of Jean ve trençkot');
    expect(screen.getByTestId(`feed.post.${PHOTO}.title`).props.accessibilityLabel).toBe('Open the details of Jean ve trençkot');

    await openDetail(PHOTO);
    expect(track).toHaveBeenCalledWith('feed_post_open', { postId: PHOTO, kind: 'editor' });

    // Header: back, the author with the verified mark; no "⋯" on an editor post.
    expect(screen.getByTestId('feed.detail.back')).toBeTruthy();
    const author = within(screen.getByTestId('feed.detail.author'));
    expect(author.getByText('Droblet Edit')).toBeTruthy();
    expect(author.getByLabelText('Verified account')).toBeTruthy();
    expect(screen.queryByTestId('feed.detail.menu')).toBeNull();

    // Two photographs: the counter, and each opens the viewer.
    expect(screen.getByTestId('feed.detail.counter')).toHaveTextContent('1 / 2');
    expect(screen.getByTestId('feed.detail.photo.0').props.accessibilityRole).toBe('imagebutton');
    expect(screen.getByTestId('feed.detail.photo.0').props.accessibilityLabel).toBe('Jean ve trençkot, photo 1 of 2');

    expect(screen.getByTestId('feed.detail.eyebrow')).toHaveTextContent(/^WEEKEND · [A-Z]+ · 1D$/);
    expect(screen.getByTestId('feed.detail.title')).toHaveTextContent('Jean ve trençkot');
    expect(screen.getByTestId('feed.detail.note')).toHaveTextContent('Bej trençkot her jean ile çalışır.');

    // "Pieces · 3": the sub-type names, the category where there is none; no products, no prices.
    expect(screen.getByTestId('feed.detail.piecesTitle')).toHaveTextContent('Pieces · 3');
    expect(screen.getByTestId('feed.detail.piece.0.name')).toHaveTextContent('Trench coat');
    expect(screen.getByTestId('feed.detail.piece.1.name')).toHaveTextContent('Jeans');
    expect(screen.getByTestId('feed.detail.piece.2.name')).toHaveTextContent('Shoes');
    expect(screen.queryByTestId('feed.detail.products')).toBeNull();
    expect(screen.queryByTestId('feed.detail.buy')).toBeNull();
    expect(within(screen.getByTestId('feed.detail.pieces')).queryAllByRole('link')).toHaveLength(0);

    // A piece with a picture opens it in the full-screen viewer; one without is not tappable.
    expect(screen.getByTestId('feed.detail.piece.2.photo').props.accessibilityRole).toBeUndefined();
    const first = screen.getByTestId('feed.detail.piece.0.photo');
    expect(first.props.accessibilityRole).toBe('imagebutton');
    expect(first.props.accessibilityLabel).toBe('Trench coat, piece photo');
    await fireEvent.press(first);
    await waitFor(() => expect(screen.getByTestId('image-viewer')).toBeTruthy(), WAIT);

    // The card's offers: "Add to my looks" and the try-on in the bar.
    expect(screen.getByTestId('feed.detail.addToLooks')).toHaveTextContent('Add to my looks');
    expect(screen.queryByTestId('feed.detail.buildWithMine')).toBeNull();
    expect(screen.queryByTestId('feed.detail.similar')).toBeNull();
    expect(screen.getByTestId('feed.detail.tryOn')).toHaveTextContent('Try it on me · 1 credit');
    expect(screen.getByTestId('feed.detail.likes')).toHaveTextContent('978');
  });

  it('in Turkish: "Parçalar · 3" and the sub-type names', async () => {
    await i18n.changeLanguage('tr');
    await openFeed();
    expect(screen.getByTestId(`feed.post.${PHOTO}.photo.0`).props.accessibilityLabel).toBe('Jean ve trençkot gönderisinin detayını aç');
    await openDetail(PHOTO);
    expect(screen.getByTestId('feed.detail.piecesTitle')).toHaveTextContent('Parçalar · 3');
    expect(screen.getByTestId('feed.detail.piece.0.name')).toHaveTextContent('Trençkot');
    expect(screen.getByTestId('feed.detail.piece.1.name')).toHaveTextContent('Jean');
    expect(screen.getByTestId('feed.detail.piece.2.name')).toHaveTextContent('Ayakkabı');
    expect(screen.getByTestId('feed.detail.tryOn')).toHaveTextContent('Üzerimde dene · 1 kredi');
    expect(screen.getByTestId('feed.detail.addToLooks')).toHaveTextContent('Looklarıma ekle');
  });

  it('"Add to my looks" on the detail opens the same sheet', async () => {
    await openFeed();
    await openDetail(PHOTO, 'title');
    await fireEvent.press(screen.getByTestId('feed.detail.addToLooks'));
    await waitFor(() => expect(screen.getByTestId('feed.lookSheet')).toBeTruthy(), WAIT);
    expect(within(screen.getByTestId('feed.lookSheet')).getByTestId('feed.lookSheet.subtitle')).toHaveTextContent('Jean ve trençkot');
  });

  it('the title of an editor post with products opens its detail: the products with brand, price and "In your wardrobe"', async () => {
    const track = jest.spyOn(analytics, 'track');
    await openFeed();
    await openDetail(PRODUCTS, 'title');
    expect(track).toHaveBeenCalledWith('feed_post_open', { postId: PRODUCTS, kind: 'editor' });

    expect(screen.getByTestId('feed.detail.title')).toHaveTextContent('Ofiste bordo & camel');
    expect(screen.getByTestId('feed.detail.counter')).toHaveTextContent('1 / 4');
    expect(screen.getByTestId('feed.detail.piecesTitle')).toHaveTextContent('Pieces · 4');
    expect(screen.queryByTestId('feed.detail.pieces')).toBeNull();

    // A product row: name, "Brand · price", it opens the product page.
    const row = screen.getByTestId('feed.detail.product.prod_004');
    expect(row.props.accessibilityRole).toBe('link');
    expect(row.props.accessibilityLabel).toMatch(/^City Medium Siyah Çanta, Beymen Club, .*\d/);
    expect(screen.getByTestId('feed.detail.product.prod_004.meta')).toHaveTextContent(/^Beymen Club · .*\d/);
    expect(screen.queryByTestId('feed.detail.product.prod_004.owned')).toBeNull();
    // An owned one carries the mark.
    expect(screen.getByTestId('feed.detail.product.prod_011.owned')).toHaveTextContent('In your wardrobe');
    expect(screen.getByTestId('feed.detail.product.prod_011').props.accessibilityLabel).toMatch(/, In your wardrobe$/);

    // The card's offers for this post.
    expect(screen.getByTestId('feed.detail.buildWithMine')).toHaveTextContent('Build it with my pieces');
    expect(screen.getByTestId('feed.detail.buy')).toBeTruthy();
    expect(screen.getByTestId('feed.detail.tryOn')).toBeTruthy();
    expect(screen.queryByTestId('feed.detail.addToLooks')).toBeNull();

    // "Buy" opens the sheet of the look's products.
    await fireEvent.press(screen.getByTestId('feed.detail.buy'));
    await waitFor(() => expect(screen.getByTestId('feed.buy.open.prod_004')).toBeTruthy(), WAIT);

    await fireEvent.press(row);
    await waitFor(() => expect(screen).toHavePathname('/shop/product/prod_004'), WAIT);
  });

  it("a member's look opens its detail from the cover and from the name: profile link, \"⋯\", pieces, \"See similar\" — no try-on, no buying", async () => {
    const track = jest.spyOn(analytics, 'track');
    await openFeed();
    expect(screen.getByTestId(`feed.post.${USER_POST}.title`).props.accessibilityLabel).toBe('Open the details of Desenli kazak');
    await openDetail(USER_POST);
    expect(track).toHaveBeenCalledWith('feed_post_open', { postId: USER_POST, kind: 'user' });

    const author = screen.getByTestId('feed.detail.author');
    expect(author.props.accessibilityRole).toBe('link');
    expect(author.props.accessibilityLabel).toBe("Open @ornek_kullanici's profile");
    expect(within(author).queryByLabelText('Verified account')).toBeNull();
    expect(screen.getByTestId('feed.detail.menu').props.accessibilityLabel).toBe('Post options');
    expect(screen.getByTestId('feed.detail.eyebrow')).toHaveTextContent('COMMUNITY · WEEKEND · 1H');
    expect(screen.getByTestId('feed.detail.title')).toHaveTextContent('Desenli kazak');
    expect(screen.queryByTestId('feed.detail.counter')).toBeNull();

    expect(screen.getByTestId('feed.detail.piecesTitle')).toHaveTextContent('Pieces · 4');
    for (const [i, name] of ['Top', 'Bottom', 'Shoes', 'Bag'].entries()) expect(screen.getByTestId(`feed.detail.piece.${i}.name`)).toHaveTextContent(name);

    expect(screen.getByTestId('feed.detail.likes')).toHaveTextContent('38');
    expect(screen.getByTestId('feed.detail.save')).toBeTruthy();
    expect(screen.queryByTestId('feed.detail.tryOn')).toBeNull();
    expect(screen.queryByTestId('feed.detail.buy')).toBeNull();
    expect(screen.queryByTestId('feed.detail.addToLooks')).toBeNull();

    await fireEvent.press(screen.getByTestId('feed.detail.similar'));
    expect(track).toHaveBeenCalledWith('feed_similar_open', { postId: USER_POST });
    await waitFor(() => expect(screen.getByTestId('feed.similar.prod_022')).toBeTruthy(), WAIT);
  });

  it('"⋯" › "Don\'t show this" on the detail closes it and takes the post out of the feed', async () => {
    await openFeed();
    await openDetail(USER_POST, 'title');
    await fireEvent.press(screen.getByTestId('feed.detail.menu'));
    await waitFor(() => expect(screen.getByTestId('feed.postMenu.hide')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('feed.postMenu.hide'));
    await waitFor(() => expect(screen).toHavePathname('/'), WAIT);
    await waitFor(() => expect(screen.queryByTestId(`feed.post.${USER_POST}`)).toBeNull(), WAIT);
    expect(screen.queryByTestId('state-not-found')).toBeNull();
    expect(screen.getByTestId(`feed.post.${PHOTO}`)).toBeTruthy();
  });

  it('a like on the detail shows on the card, and a like on the card shows on the detail', async () => {
    await openFeed();
    await openDetail(PRODUCTS);
    expect(screen.getByTestId('feed.detail.likes')).toHaveTextContent('1,284');
    expect(screen.getByTestId('feed.detail.like').props.accessibilityState).toMatchObject({ selected: false });

    await fireEvent.press(screen.getByTestId('feed.detail.like'));
    await waitFor(() => expect(screen.getByTestId('feed.detail.likes')).toHaveTextContent('1,285'), WAIT);
    expect(screen.getByTestId('feed.detail.like').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('feed.detail.likes').props.accessibilityLabel).toBe('1,285 likes');

    // Back on Akış the card has it.
    await fireEvent.press(screen.getByTestId('feed.detail.back'));
    await waitFor(() => expect(screen).toHavePathname('/'), WAIT);
    await waitFor(() => expect(screen.getByTestId(`feed.post.${PRODUCTS}.likes`)).toHaveTextContent('1,285 likes'), WAIT);
    expect(screen.getByTestId(`feed.post.${PRODUCTS}.like`).props.accessibilityState).toMatchObject({ selected: true });

    // Unliked and saved on the card: the detail follows.
    await fireEvent.press(screen.getByTestId(`feed.post.${PRODUCTS}.like`));
    await fireEvent.press(screen.getByTestId(`feed.post.${PRODUCTS}.save`));
    await waitFor(() => expect(screen.getByTestId(`feed.post.${PRODUCTS}.likes`)).toHaveTextContent('1,284 likes'), WAIT);
    await openDetail(PRODUCTS, 'title');
    expect(screen.getByTestId('feed.detail.likes')).toHaveTextContent('1,284');
    expect(screen.getByTestId('feed.detail.like').props.accessibilityState).toMatchObject({ selected: false });
    expect(screen.getByTestId('feed.detail.save').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('a post only Kaydedilenler holds stays open when its save is removed on the detail', async () => {
    feedFixtures.save('post_003', true);
    await renderRouter('./src/app', { initialUrl: '/friends/saved?tab=feed' });
    await waitFor(() => expect(screen.getByTestId('feed.post.post_003')).toBeTruthy(), WAIT);
    await openDetail('post_003');
    expect(screen.getByTestId('feed.detail.save').props.accessibilityState).toMatchObject({ selected: true });

    await fireEvent.press(screen.getByTestId('feed.detail.save'));
    await waitFor(() => expect(feedFixtures.saved()).toEqual([]), WAIT);
    await waitFor(() => expect(screen.getByTestId('feed.detail.save').props.accessibilityState).toMatchObject({ selected: false }), WAIT);
    expect(screen.getByTestId('feed.detail.title')).toHaveTextContent('Davette saten');
    expect(screen.queryByTestId('state-not-found')).toBeNull();
  });

  it('opened cold (a link, a restart): the post is read by its id and drawn like any other', async () => {
    await AsyncStorage.setItem(triedOnKey('u1'), 'yes');
    await renderRouter('./src/app', { initialUrl: `/feed/${PHOTO}` });
    await waitFor(() => expect(screen.getByTestId('feed.detail')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('feed.detail.title')).toHaveTextContent('Jean ve trençkot');
    expect(screen.queryByTestId('state-not-found')).toBeNull();

    // A like works on it as on a post opened from the feed.
    const before = screen.getByTestId('feed.detail.like').props.accessibilityState.selected;
    await fireEvent.press(screen.getByTestId('feed.detail.like'));
    await waitFor(() => expect(screen.getByTestId('feed.detail.like').props.accessibilityState.selected).toBe(!before), WAIT);
  });

  it('opened cold with an id that is not on the feed: says so and leads back to Akış', async () => {
    await AsyncStorage.setItem(triedOnKey('u1'), 'yes');
    await renderRouter('./src/app', { initialUrl: '/feed/post_404' });
    await waitFor(() => expect(screen.getByTestId('state-not-found')).toBeTruthy(), WAIT);
    expect(screen.getByText('This post is no longer on the feed.')).toBeTruthy();
    expect(screen.queryByTestId('feed.detail')).toBeNull();
    expect(screen.getByLabelText('Go back')).toBeTruthy();

    await fireEvent.press(screen.getByText('Back to the feed'));
    await waitFor(() => expect(screen).toHavePathname('/'), WAIT);
    await waitFor(() => expect(screen.getByTestId('feed.list')).toBeTruthy(), WAIT);
  });

  it('a teen sees no prices and nothing to buy; the products do not open the store', async () => {
    mockTeen = true;
    const all = feedFixtures.page('all', null).items;
    feedFixtureOptions.setPosts([all.find((p) => p.id === PRODUCTS)!, all.find((p) => p.id === PHOTO)!]);
    await AsyncStorage.setItem(triedOnKey('u1'), 'yes');
    await renderRouter('./src/app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId(`feed.post.${PRODUCTS}`)).toBeTruthy(), WAIT);
    await openDetail(PRODUCTS);

    expect(screen.getByTestId('feed.detail.piecesTitle')).toHaveTextContent('Pieces · 4');
    const row = screen.getByTestId('feed.detail.product.prod_004');
    expect(row.props.accessibilityRole).toBeUndefined();
    expect(row.props.accessibilityLabel).toBe('City Medium Siyah Çanta, Beymen Club');
    expect(screen.getByTestId('feed.detail.product.prod_004.meta')).toHaveTextContent(/^Beymen Club$/);
    expect(screen.getByTestId('feed.detail.product.prod_011.owned')).toBeTruthy();
    expect(screen.queryByTestId('feed.detail.buy')).toBeNull();
    expect(screen.queryByTestId('feed.detail.buyable')).toBeNull();
    // ♡, Kaydet and the try-on stay, as on the card.
    expect(screen.getByTestId('feed.detail.like')).toBeTruthy();
    expect(screen.getByTestId('feed.detail.save')).toBeTruthy();
    expect(screen.getByTestId('feed.detail.tryOn')).toBeTruthy();

    await fireEvent.press(row);
    expect(screen).toHavePathname(`/feed/${PRODUCTS}`);
  });
});

describe('Akış · piece names', () => {
  it('the wire carries the sub-type; the name is the sub-type, else the kind', async () => {
    expect(toFeedPiece({ category: 'outerwear', subcategory: 'trench-coat', imageUrl: 'https://cdn.example.com/a.png' })).toEqual({
      category: 'outerwear',
      subcategory: 'trench-coat',
      imageUrl: 'https://cdn.example.com/a.png',
    });
    // Older servers leave it out.
    expect(toFeedPiece({ category: 'shoes', imageUrl: null })).toEqual({ category: 'shoes', subcategory: null, imageUrl: null });

    const t = i18n.getFixedT('en');
    expect(pieceName(t, { category: 'outerwear', subcategory: 'trench-coat' })).toBe('Trench coat');
    expect(pieceName(t, { category: 'shoes', subcategory: null })).toBe('Shoes');
    expect(pieceName(t, { category: 'bag' })).toBe('Bag');
    await i18n.changeLanguage('tr');
    expect(pieceName(i18n.getFixedT('tr'), { category: 'outerwear', subcategory: 'trench-coat' })).toBe('Trençkot');
    expect(pieceName(i18n.getFixedT('tr'), { category: 'outerwear' })).toBe('Dış giyim');
  });
});
