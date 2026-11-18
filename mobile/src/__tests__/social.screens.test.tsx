import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Linking } from 'react-native';

import { resetSocialFixtures } from '@/fixtures/social';
import { resetStoreFixtures } from '@/fixtures/store';
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
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

const clipboard = jest.requireMock('expo-clipboard') as { setStringAsync: jest.Mock };
const TIMEOUT = { timeout: 4000 };
const LOOK_LINK = 'https://droplet.alatech.co/l/flook_1?invite=DAMLA24';

async function open(url: string) {
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
  await renderRouter('./src/app', { initialUrl: url });
}

async function openShareSheet() {
  await open('/friends/feed');
  await waitFor(() => expect(screen.getAllByLabelText('Share').length).toBeGreaterThan(0), TIMEOUT);
  await fireEvent.press(screen.getAllByLabelText('Share')[0]!);
  await waitFor(() => expect(screen.getByText('Share the look')).toBeTruthy(), TIMEOUT);
}

let openURL: jest.SpyInstance;

beforeEach(async () => {
  resetSocialFixtures();
  resetStoreFixtures();
  clipboard.setStringAsync.mockReset();
  clipboard.setStringAsync.mockResolvedValue(true);
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await AsyncStorage.clear();
  await i18n.changeLanguage('en');
});

afterEach(() => {
  openURL.mockRestore();
});

describe('25 Arkadaş akışı', () => {
  it('shows the header, the post as drawn and opens 27 from "Find friends"', async () => {
    await open('/friends/feed');
    await waitFor(() => expect(screen.getByText('What are your friends wearing?')).toBeTruthy(), TIMEOUT);
    await waitFor(() => expect(screen.getByText(/Wedding · 2 hours ago/)).toBeTruthy(), TIMEOUT);
    // Nobody has a photo in the fixtures: initials for people, the piece collage for a post without a picture.
    expect(screen.getAllByTestId('image-slot-avatar').length).toBeGreaterThan(0);
    expect(screen.getAllByText('S').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('image-slot-collage').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Selin, new look')).toBeTruthy();
    expect(screen.getAllByText('Following').length).toBeGreaterThan(0);
    expect(screen.getAllByText('See the pieces').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Save').length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByLabelText('Find friends'));
    await waitFor(() => expect(screen.getByText('Discover wardrobes')).toBeTruthy(), TIMEOUT);
  });

  it('share sheet offers WhatsApp, Pinterest and "Copy link"; WhatsApp opens wa.me with the invite link', async () => {
    await openShareSheet();
    expect(screen.getByText('WhatsApp')).toBeTruthy();
    expect(screen.getByText('Pinterest')).toBeTruthy();
    expect(screen.getByText('Copy link')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('share-whatsapp'));
    await waitFor(() => expect(openURL).toHaveBeenCalledTimes(1), TIMEOUT);
    const target = String(openURL.mock.calls[0]?.[0]);
    expect(target.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(target)).toContain(LOOK_LINK);
    await waitFor(() => expect(screen.queryByText('Share the look')).toBeNull(), TIMEOUT);
  });

  it('Pinterest opens the pin builder with the link and a description', async () => {
    await openShareSheet();
    await fireEvent.press(screen.getByTestId('share-pinterest'));
    await waitFor(() => expect(openURL).toHaveBeenCalledTimes(1), TIMEOUT);
    const target = String(openURL.mock.calls[0]?.[0]);
    expect(target.startsWith('https://www.pinterest.com/pin/create/button/?url=')).toBe(true);
    expect(target).toContain(`url=${encodeURIComponent(LOOK_LINK)}`);
    expect(target).toContain('&description=');
  });

  it('"Copy link" puts the link on the clipboard, closes the sheet and confirms', async () => {
    await openShareSheet();
    await fireEvent.press(screen.getByTestId('share-link'));
    await waitFor(() => expect(clipboard.setStringAsync).toHaveBeenCalledWith(LOOK_LINK), TIMEOUT);
    await waitFor(() => expect(screen.getByText('Link copied.')).toBeTruthy(), TIMEOUT);
    expect(screen.queryByText('Share the look')).toBeNull();
    expect(openURL).not.toHaveBeenCalled();
  });

  it('stays open with a calm message when the target cannot be opened or the copy fails', async () => {
    openURL.mockRejectedValue(new Error('no handler'));
    await openShareSheet();
    await fireEvent.press(screen.getByTestId('share-whatsapp'));
    await waitFor(() => expect(screen.getByText(/We couldn't open it right now/)).toBeTruthy(), TIMEOUT);
    expect(screen.getByText('Share the look')).toBeTruthy();

    clipboard.setStringAsync.mockRejectedValue(new Error('denied'));
    await fireEvent.press(screen.getByTestId('share-link'));
    await waitFor(() => expect(screen.getByText("The link couldn't be copied. Try again.")).toBeTruthy(), TIMEOUT);
    expect(screen.getByText('Share the look')).toBeTruthy();
  });
});

describe('26 Kişi profili', () => {
  it('shows counters, both actions, the three sections and the look grid', async () => {
    await open('/u/elif');
    await waitFor(() => expect(screen.getByText('Elif')).toBeTruthy(), TIMEOUT);
    // 26: initials for the person; the look grid draws the figure, one placeholder per tile.
    expect(screen.getByText('E')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByTestId('image-slot-figure').length).toBe(6), TIMEOUT);
    expect(screen.getByLabelText('Pieces: 96')).toBeTruthy();
    expect(screen.getByLabelText('Looks: 21')).toBeTruthy();
    expect(screen.getByLabelText('Style match: 88%')).toBeTruthy();
    expect(screen.getByText('Explore closet')).toBeTruthy();
    expect(screen.getByText('Trips')).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('Look 6')).toBeTruthy(), TIMEOUT);

    await fireEvent.press(screen.getByText('Follow'));
    await waitFor(() => expect(screen.getByText('Following')).toBeTruthy(), TIMEOUT);

    await fireEvent.press(screen.getByText('Explore closet'));
    await waitFor(() => expect(screen.getByLabelText('Parça 9')).toBeTruthy(), TIMEOUT);
  });

  it('⋯ menu copies the profile link and confirms', async () => {
    await open('/u/selin');
    await waitFor(() => expect(screen.getByTestId('person-more')).toBeTruthy(), TIMEOUT);
    await fireEvent.press(screen.getByTestId('person-more'));
    expect(screen.getByText('Copy profile link')).toBeTruthy();
    expect(screen.getByText('Report')).toBeTruthy();
    expect(screen.getByText('Block')).toBeTruthy();

    await fireEvent.press(screen.getByText('Copy profile link'));
    await waitFor(
      () => expect(clipboard.setStringAsync).toHaveBeenCalledWith('https://droplet.alatech.co/u/selin?invite=DAMLA24'),
      TIMEOUT,
    );
    await waitFor(() => expect(screen.getByText('Profile link copied.')).toBeTruthy(), TIMEOUT);
    expect(screen.queryByText('Copy profile link')).toBeNull();
  });

  it('private closet: dashes for the counters, one action, the dashed "private" box, no sections', async () => {
    await open('/u/deniz');
    await waitFor(() => expect(screen.getByText('This closet is private')).toBeTruthy(), TIMEOUT);
    expect(screen.getByLabelText('Pieces: —')).toBeTruthy();
    expect(screen.getByLabelText('Looks: —')).toBeTruthy();
    expect(screen.getByText(/Deniz keeps their closet and looks visible only to themselves/)).toBeTruthy();
    expect(screen.getByText('Follow')).toBeTruthy();
    expect(screen.queryByText('Explore closet')).toBeNull();
    expect(screen.queryByText('Trips')).toBeNull();
  });
});

describe('26b Şikayet et / engelle', () => {
  async function openReport() {
    await open('/u/selin');
    await waitFor(() => expect(screen.getByTestId('person-more')).toBeTruthy(), TIMEOUT);
    await fireEvent.press(screen.getByTestId('person-more'));
    await fireEvent.press(screen.getByText('Report'));
    await waitFor(() => expect(screen.getByText('Report Selin')).toBeTruthy(), TIMEOUT);
  }

  it('lists the six reasons, sends the report, closes and confirms on the profile', async () => {
    await openReport();
    for (const reason of [
      'Inappropriate content',
      'Harassment or bullying',
      'Fake account',
      'Photo shared without permission',
      'Spam',
      'Other',
    ]) {
      expect(screen.getByLabelText(reason)).toBeTruthy();
    }
    expect(screen.getByLabelText('Inappropriate content').props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByLabelText('Spam'));
    expect(screen.getByLabelText('Spam').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByLabelText('Inappropriate content').props.accessibilityState).toMatchObject({ checked: false });

    await fireEvent.press(screen.getByTestId('report-submit'));
    await waitFor(() => expect(screen.getByText(/We've received your report/)).toBeTruthy(), TIMEOUT);
    expect(screen.queryByText('Report Selin')).toBeNull();
    expect(screen.getByText('Selin')).toBeTruthy();
  });

  it('blocking leaves the profile for the feed, without that person', async () => {
    await openReport();
    expect(screen.getByText(/won't be able to see you or rate your looks/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Block Selin'));
    await waitFor(() => expect(screen.getByText('What are your friends wearing?')).toBeTruthy(), TIMEOUT);
    await waitFor(() => expect(screen.getAllByText('Ayşe').length).toBeGreaterThan(0), TIMEOUT);
    await waitFor(() => expect(screen.queryByText('Selin')).toBeNull(), TIMEOUT);
  });
});

describe('27 Dolapları keşfet', () => {
  it('shows search, the contacts card, sample influencer closets and similar closets', async () => {
    await open('/friends/find');
    await waitFor(() => expect(screen.getByText('@ornek_stilist')).toBeTruthy(), TIMEOUT);
    expect(screen.getByLabelText('Search usernames')).toBeTruthy();
    expect(screen.getByText('Find friends from your contacts')).toBeTruthy();
    expect(screen.getByText('Invite link')).toBeTruthy();
    expect(screen.getByText('Sample')).toBeTruthy();
    // The second card's name comes from the shared creators fixture; its role line is ours.
    expect(screen.getByText('Editör · placeholder')).toBeTruthy();
    expect(screen.getByText('Stil danışmanı · placeholder')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('88% style match')).toBeTruthy(), TIMEOUT);
    expect(screen.getByText('81% style match')).toBeTruthy();

    // No contacts permission is requested (open decision A-8): the button explains instead.
    await fireEvent.press(screen.getByText('Allow contacts'));
    await waitFor(() => expect(screen.getByText(/coming soon/)).toBeTruthy(), TIMEOUT);
  });

  it('follows from the list and finds people by username', async () => {
    await open('/friends/find');
    await waitFor(() => expect(screen.getByText('Elif')).toBeTruthy(), TIMEOUT);
    await fireEvent.press(screen.getAllByText('Follow')[0]!);
    await waitFor(() => expect(screen.getByText('Following')).toBeTruthy(), TIMEOUT);

    await fireEvent.changeText(screen.getByLabelText('Search usernames'), '@den');
    await waitFor(() => expect(screen.getByText('Deniz')).toBeTruthy(), TIMEOUT);
    expect(screen.queryByText('Find friends from your contacts')).toBeNull();
  });
});
