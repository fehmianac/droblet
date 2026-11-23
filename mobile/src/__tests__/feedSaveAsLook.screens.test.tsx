import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import * as analytics from '@/analytics/track';
import { ApiError } from '@/api/errors';
import { triedOnKey } from '@/features/credits/spendConfirm';
import { resetFeedSession } from '@/features/feed/logic';
import { saveAsLookErrorKey } from '@/features/feed/mutations';
import { storySeenStore } from '@/features/feed/storySeen';
import { fixtureDb, resetFixtureDb } from '@/fixtures/db';
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

const WAIT = { timeout: 4000 };
/** The fixture photograph without products: "Jean ve trençkot" — outerwear, bottom, shoes. */
const PHOTO = 'post_005';

/** Akış with the product post and the photograph (optionally changed) only. */
async function openFeed(change?: (post: ReturnType<typeof feedFixtures.page>['items'][number]) => void) {
  const items = feedFixtures.page('all', null).items;
  const photo = items.find((p) => p.id === PHOTO)!;
  change?.(photo);
  feedFixtureOptions.setPosts([items.find((p) => p.id === 'post_001')!, photo]);
  await AsyncStorage.setItem(triedOnKey('u1'), 'yes');
  await renderRouter('./src/app', { initialUrl: '/' });
  await waitFor(() => expect(screen.getByTestId(`feed.post.${PHOTO}`)).toBeTruthy(), WAIT);
}

async function openSheet() {
  await fireEvent.press(screen.getByTestId(`feed.post.${PHOTO}.addToLooks`));
  await waitFor(() => expect(screen.getByTestId('feed.lookSheet')).toBeTruthy(), WAIT);
  return within(screen.getByTestId('feed.lookSheet'));
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

describe('Akış · "Looklarıma ekle" (owner decision 2026-11-23)', () => {
  it('a post with pieces offers "Add to my looks"; the sheet names the post and the two ways', async () => {
    await openFeed();
    const post = within(screen.getByTestId(`feed.post.${PHOTO}`));
    expect(post.getByTestId(`feed.post.${PHOTO}.addToLooks`)).toHaveTextContent('Add to my looks');
    // ♡ and the bookmark stay; a post without pieces has no such action.
    expect(post.getByTestId(`feed.post.${PHOTO}.like`)).toBeTruthy();
    expect(post.getByTestId(`feed.post.${PHOTO}.save`)).toBeTruthy();
    expect(screen.queryByTestId('feed.post.post_001.addToLooks')).toBeNull();

    const sheet = await openSheet();
    expect(sheet.getByRole('header')).toHaveTextContent('Add to my looks');
    expect(sheet.getByTestId('feed.lookSheet.subtitle')).toHaveTextContent('Jean ve trençkot');
    expect(sheet.getByTestId('feed.lookSheet.inspiration').props.accessibilityLabel).toBe(
      'Save as inspiration. The photo becomes the cover; the pieces are not added to your wardrobe.',
    );
    expect(sheet.getByTestId('feed.lookSheet.pieces').props.accessibilityLabel).toBe(
      'Save with its pieces. 3 pieces are added to your wardrobe and the look is made of them.',
    );
    expect(sheet.getByTestId('feed.lookSheet.cancel')).toHaveTextContent('Cancel');

    await fireEvent.press(sheet.getByTestId('feed.lookSheet.cancel'));
    await waitFor(() => expect(screen.queryByTestId('feed.lookSheet')).toBeNull(), WAIT);
    expect(fixtureDb.looks).toHaveLength(4);
  });

  it('in Turkish the sheet reads as on the board', async () => {
    await i18n.changeLanguage('tr');
    await openFeed();
    expect(screen.getByTestId(`feed.post.${PHOTO}.addToLooks`)).toHaveTextContent('Looklarıma ekle');
    const sheet = await openSheet();
    expect(sheet.getByRole('header')).toHaveTextContent('Looklarıma ekle');
    expect(sheet.getByTestId('feed.lookSheet.inspiration').props.accessibilityLabel).toBe('İlham olarak kaydet. Fotoğraf kapak olur, parçalar gardırobuna eklenmez.');
    expect(sheet.getByTestId('feed.lookSheet.pieces').props.accessibilityLabel).toBe('Parçalarıyla kaydet. 3 parça gardırobuna eklenir ve look onlardan oluşur.');
    expect(sheet.getByTestId('feed.lookSheet.cancel')).toHaveTextContent('Vazgeç');
  });

  it('"Save as inspiration" makes a look without pieces; the toast\'s "Gör" opens it: photo, tag, one line, no piece actions', async () => {
    const track = jest.spyOn(analytics, 'track');
    await openFeed();
    const items = fixtureDb.items.length;
    const sheet = await openSheet();
    await fireEvent.press(sheet.getByTestId('feed.lookSheet.inspiration'));

    await waitFor(() => expect(screen.getByTestId('toast-feed-look')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('toast-message')).toHaveTextContent('Added to your looks');
    await waitFor(() => expect(screen.queryByTestId('feed.lookSheet')).toBeNull(), WAIT);
    expect(track).toHaveBeenCalledWith('feed_save_as_look', { postId: PHOTO, mode: 'inspiration' });
    const look = fixtureDb.looks[0]!;
    expect(look).toMatchObject({ name: 'Jean ve trençkot', occasion: 'weekend', slots: [], inspiration: true });
    expect(fixtureDb.looks).toHaveLength(5);
    expect(fixtureDb.items).toHaveLength(items); // nothing added to the wardrobe

    expect(screen.getByTestId('toast-action')).toHaveTextContent('View');
    await fireEvent.press(screen.getByTestId('toast-action'));
    await waitFor(() => expect(screen.getByTestId('look-inspiration')).toBeTruthy(), WAIT);
    expect(screen).toHavePathname(`/look/${look.id}`);
    expect(screen.getByTestId('look-inspiration-photo')).toBeTruthy();
    expect(screen.getByTestId('look-inspiration-eyebrow')).toHaveTextContent('INSPIRATION · WEEKEND');
    expect(screen.getByText('INSPIRATION')).toBeTruthy();
    expect(screen.getByTestId('look-inspiration-no-pieces')).toHaveTextContent('The pieces are not in your wardrobe');
    // No piece list, no share to Akış, no edit, no share; favourite and try-on (its photograph) stay.
    expect(screen.queryByTestId('look-hero')).toBeNull();
    expect(screen.queryByTestId('look-edit')).toBeNull();
    expect(screen.queryByTestId('look-share')).toBeNull();
    expect(screen.queryByTestId('feed-share-card')).toBeNull();
    expect(screen.getByTestId('look-try-on')).toBeTruthy();
    expect(screen.getByLabelText('Jean ve trençkot: add to favourites')).toBeTruthy();
  });

  it('the same post saved as inspiration again answers the same look', async () => {
    await openFeed();
    await fireEvent.press((await openSheet()).getByTestId('feed.lookSheet.inspiration'));
    await waitFor(() => expect(screen.queryByTestId('feed.lookSheet')).toBeNull(), WAIT);
    await fireEvent.press((await openSheet()).getByTestId('feed.lookSheet.inspiration'));
    await waitFor(() => expect(screen.queryByTestId('feed.lookSheet')).toBeNull(), WAIT);
    expect(fixtureDb.looks.filter((l) => l.inspiration)).toHaveLength(1);
  });

  it('"Save with its pieces" adds the pieces to the wardrobe and makes a look of them', async () => {
    const track = jest.spyOn(analytics, 'track');
    await openFeed();
    const items = fixtureDb.items.length;
    const sheet = await openSheet();
    await fireEvent.press(sheet.getByTestId('feed.lookSheet.pieces'));

    await waitFor(() => expect(screen.getByTestId('toast-feed-look')).toBeTruthy(), WAIT);
    await waitFor(() => expect(screen.queryByTestId('feed.lookSheet')).toBeNull(), WAIT);
    expect(track).toHaveBeenCalledWith('feed_save_as_look', { postId: PHOTO, mode: 'pieces' });
    expect(fixtureDb.items).toHaveLength(items + 3);
    expect(fixtureDb.items.slice(0, 3).map((i) => [i.category, i.name, i.color, i.seasons.length])).toEqual([
      ['outerwear', 'Outerwear', 'other', 4],
      ['bottom', 'Bottom', 'other', 4],
      ['shoes', 'Shoes', 'other', 4],
    ]);
    const look = fixtureDb.looks[0]!;
    expect(look.inspiration).toBeUndefined();
    expect(look.slots.map((s) => [s.slot, s.source])).toEqual([
      ['bottom', 'wardrobe'],
      ['outerwear', 'wardrobe'],
      ['shoes', 'wardrobe'],
    ]);

    // "Gör" opens a normal look: the hero with its pieces, edit and "Share on the feed" available.
    await fireEvent.press(screen.getByTestId('toast-action'));
    await waitFor(() => expect(screen.getByTestId('look-hero')).toBeTruthy(), WAIT);
    expect(screen.queryByTestId('look-inspiration')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('look-edit')).toBeTruthy(), WAIT);
  });

  it('a post with one piece can only be saved as inspiration', async () => {
    await openFeed((photo) => {
      photo.pieces = [{ category: 'dress', imageUrl: null }];
    });
    const sheet = await openSheet();
    const pieces = sheet.getByTestId('feed.lookSheet.pieces');
    expect(pieces.props.accessibilityState).toMatchObject({ disabled: true });
    expect(pieces.props.accessibilityLabel).toBe('Save with its pieces. This post does not have enough pieces for a look.');
    await fireEvent.press(pieces);
    expect(fixtureDb.looks).toHaveLength(4);
    expect(sheet.getByTestId('feed.lookSheet.inspiration').props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('a failure keeps the sheet open and says so; nothing is created', async () => {
    await openFeed();
    feedFixtureOptions.failNextSaveAsLook(422, 'look_not_savable');
    const sheet = await openSheet();
    await fireEvent.press(sheet.getByTestId('feed.lookSheet.pieces'));

    await waitFor(() => expect(screen.getByTestId('toast-feed-look-error')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('toast-message')).toHaveTextContent('This post cannot be saved as a look.');
    expect(screen.getByTestId('feed.lookSheet')).toBeTruthy();
    expect(fixtureDb.looks).toHaveLength(4);
    // The row is ready for another try.
    await waitFor(() => expect(screen.queryByTestId('feed.lookSheet.pieces.busy')).toBeNull(), WAIT);
  });

  it('maps the server answers to their sentence (the plan limit opens the paywall)', () => {
    const problem = (status: number, code: string) => new ApiError('http', status, { status, code });
    expect(saveAsLookErrorKey(problem(403, 'premium_required'))).toBe('paywall');
    expect(saveAsLookErrorKey(problem(422, 'look_not_savable'))).toBe('notSavable');
    expect(saveAsLookErrorKey(problem(404, 'not_found'))).toBe('gone');
    expect(saveAsLookErrorKey(problem(409, 'look_id_taken'))).toBe('failed');
    expect(saveAsLookErrorKey(new Error('network'))).toBe('failed');
    expect(i18n.t('homeFeed.lookSheet.errors.failed', { lng: 'tr' })).toBe('Look kaydedilemedi. Tekrar dene.');
    expect(i18n.t('homeFeed.lookSheet.savedToast', { lng: 'tr' })).toBe('Looklarına eklendi');
  });
});

describe('14 Looklar · an inspiration look', () => {
  it('shows the photo cover with the "İLHAM" tag in the grid and opens without piece actions', async () => {
    const look = feedFixtures.saveAsLook(PHOTO, 'inspiration', '01JTESTINSPIRATION00000000');
    await renderRouter('./src/app', { initialUrl: '/wardrobe/looks' });
    await waitFor(() => expect(screen.getByTestId(`looks.tile.${look.id}`)).toBeTruthy(), WAIT);
    const tile = within(screen.getByTestId(`looks.tile.${look.id}`));
    expect(tile.getByText('INSPIRATION')).toBeTruthy();
    expect(tile.queryByText('WEEKEND')).toBeNull();
    expect(tile.getByLabelText('Inspiration, Jean ve trençkot')).toBeTruthy();
    expect(tile.queryByTestId('image-slot-flatlay')).toBeNull();

    await fireEvent.press(tile.getByLabelText('Inspiration, Jean ve trençkot'));
    await waitFor(() => expect(screen.getByTestId('look-inspiration')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('look-inspiration-no-pieces')).toBeTruthy();
    expect(screen.queryByTestId('look-edit')).toBeNull();
  });
});
