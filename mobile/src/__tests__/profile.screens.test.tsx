import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { creditSheetStore } from '@/features/credits/creditSheetStore';
import { accountFixtures, resetAccountFixtures } from '@/fixtures/account';
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

const mockEntitlement = {
  tier: 'member',
  plan: 'yearly',
  credits: { monthlyAllowance: 30, remaining: 12, resetsAt: '2026-12-01T00:00:00.000Z' },
};
jest.mock('@/entitlement/useEntitlement', () => ({
  useEntitlement: () => ({ data: mockEntitlement, isError: false, isPending: false, refetch: jest.fn() }),
}));

const WAIT = { timeout: 4000 };

async function open(url: string) {
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
  await renderRouter('./src/app', { initialUrl: url });
}

beforeEach(async () => {
  resetStoreFixtures();
  resetAccountFixtures();
  creditSheetStore.close();
  await AsyncStorage.clear();
  await i18n.changeLanguage('en');
});

describe('28 Profil', () => {
  it('shows the logo header, the identity line, the numbers and the menu exactly as drawn', async () => {
    await open('/profile');
    await waitFor(() => expect(screen.getByText('Warm Autumn')).toBeTruthy(), WAIT);
    expect(screen.getByLabelText('Droblet')).toBeTruthy();
    expect(screen.getByLabelText('Settings')).toBeTruthy();
    expect(screen.getByText('@damla · Minimal · Quiet luxury')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('profile-stats')).toHaveTextContent('86 pieces · 24 looks · 12 followers'), WAIT);

    const labels = ['Wardrobe stats', 'Trip archive', 'My colour palette', 'My watchlist', 'Membership', 'Family plan', 'Privacy, photos and settings'];
    labels.forEach((label) => expect(screen.getByText(label)).toBeTruthy());
    await waitFor(() => expect(screen.getByText('1 price drop')).toBeTruthy(), WAIT);
    expect(screen.getByText('Yearly')).toBeTruthy();
    expect(screen.getByText('Soon')).toBeTruthy();
    // "Aile planı" is visible but not available yet.
    expect(screen.getByText('Family plan')).toBeDisabled();
  });

  it('shows the credit counter with the photo status and opens the credit pack sheet', async () => {
    await open('/profile');
    await waitFor(() => expect(screen.getByText('12 of 30 images left this month')).toBeTruthy(), WAIT);
    expect(screen.getByText('AI IMAGES · NOVEMBER')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Your style photo is ready')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByLabelText('Top up credits'));
    expect(creditSheetStore.get()).toBe('topUp');
  });

  it('opens the watchlist and the settings from the menu', async () => {
    await open('/profile');
    await waitFor(() => expect(screen.getByText('My watchlist')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByText('Privacy, photos and settings'));
    await waitFor(() => expect(screen.getByText('WHO CAN SEE MY CLOSET?')).toBeTruthy(), WAIT);
  });
});

describe('Profili düzenle (derived)', () => {
  it('validates the handle, shows a taken handle and saves name + handle back to the profile', async () => {
    await open('/profile');
    await waitFor(() => expect(screen.getByText('@damla · Minimal · Quiet luxury')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByLabelText('Edit profile'));
    await waitFor(() => expect(screen.getByLabelText('Username')).toBeTruthy(), WAIT);
    expect(screen.getByLabelText('Name').props.value).toBe('Damla');
    // Nothing changed yet: nothing to save.
    expect(screen.getByTestId('profile-save')).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText('Username'), 'da');
    await fireEvent.press(screen.getByTestId('profile-save'));
    expect(screen.getByText('Your username needs at least 3 characters.')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Username'), '@Selin');
    await fireEvent.press(screen.getByTestId('profile-save'));
    await waitFor(() => expect(screen.getByText('This username is taken. Try another one.')).toBeTruthy(), WAIT);
    expect(accountFixtures.profile().handle).toBe('damla');

    await fireEvent.changeText(screen.getByLabelText('Name'), '  Damla K ');
    await fireEvent.changeText(screen.getByLabelText('Username'), '@Damla_K');
    await waitFor(() => expect(screen.getByText('@damla_k is available.')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('profile-save'));
    await waitFor(() => expect(screen.getByText('@damla_k · Minimal · Quiet luxury')).toBeTruthy(), WAIT);
    expect(screen.getByText('Damla K')).toBeTruthy();
    expect(accountFixtures.profile()).toMatchObject({ displayName: 'Damla K', handle: 'damla_k' });
  });

  it('a changed name is the Bugün greeting at once', async () => {
    await open('/profile');
    await waitFor(() => expect(screen.getByLabelText('Edit profile')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByLabelText('Edit profile'));
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeTruthy(), WAIT);
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Ayşe Kaya');
    await fireEvent.press(screen.getByTestId('profile-save'));
    await waitFor(() => expect(screen.getByText('Ayşe Kaya')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('tab.today'));
    await waitFor(() => expect(screen.getByText(/^Good (morning|afternoon|evening) Ayşe,/)).toBeTruthy(), WAIT);
    expect(screen.queryByText(/Damla/)).toBeNull();
  });

  it('profile photo: "Change photo" is back; the sheet offers camera, library and removal, and removing saves', async () => {
    accountFixtures.updateProfile(
      { displayName: 'Damla', handle: 'damla', baseVersion: 1, clientMutationId: 'm' },
      'https://example.com/avatar.jpg',
    );
    await open('/edit-profile');
    await waitFor(() => expect(screen.getByTestId('profileEdit.photo')).toBeTruthy(), WAIT);
    expect(screen.getByText('Change photo')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('profileEdit.photo'));
    await waitFor(() => expect(screen.getByText('Profile photo')).toBeTruthy(), WAIT);
    expect(screen.getByText('Take a photo')).toBeTruthy();
    expect(screen.getByText('Choose from library')).toBeTruthy();
    await fireEvent.press(screen.getByText('Remove photo'));
    await waitFor(() => expect(screen.getByText('Add photo')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('profile-save'));
    await waitFor(() => expect(accountFixtures.profile().avatarUrl).toBeNull(), WAIT);
  });

  it('requires a name', async () => {
    await open('/edit-profile');
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeTruthy(), WAIT);
    await fireEvent.changeText(screen.getByLabelText('Name'), '  ');
    await fireEvent.press(screen.getByTestId('profile-save'));
    expect(screen.getByText('Enter your name.')).toBeTruthy();
    expect(accountFixtures.profile().displayName).toBe('Damla');
  });
});

describe('29 Gizlilik ve ayarlar', () => {
  it('draws the photo tags and saves the notification check boxes', async () => {
    await open('/settings');
    await waitFor(() => expect(screen.getByText('BODY')).toBeTruthy(), WAIT);
    expect(screen.getByText('FACE')).toBeTruthy();
    expect(screen.getByLabelText('Remove full-length photo')).toBeTruthy();
    expect(screen.getByLabelText('Add photo')).toBeTruthy();

    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Friend ratings' })).not.toBeChecked(), WAIT);
    expect(screen.getByRole('checkbox', { name: 'Morning outfit reminder' })).toBeChecked();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Friend ratings' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Friend ratings' })).toBeChecked(), WAIT);
    await waitFor(() => expect(accountFixtures.notifications().friendRatings).toBe(true), WAIT);
  });

  it('offers the reminder time only while the morning reminder is on and stores the picked time', async () => {
    await open('/settings');
    await waitFor(() => expect(screen.getByText('Reminder time')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByText('Reminder time'));
    await fireEvent.press(screen.getByText('09:00'));
    await waitFor(() => expect(screen.getByLabelText('Reminder time: 09:00')).toBeTruthy(), WAIT);

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Morning outfit reminder' }));
    await waitFor(() => expect(screen.queryByText('Reminder time')).toBeNull(), WAIT);
    await waitFor(() => expect(accountFixtures.notifications().morningReminder).toBe(false), WAIT);
  });

  it('29b lists what is deleted and deletes the photos only after the confirmation', async () => {
    await open('/settings');
    await waitFor(() => expect(screen.getByLabelText('Remove full-length photo')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByText('Delete my photos and generated images'));
    expect(screen.getByText('Delete your photos and generated images?')).toBeTruthy();
    expect(screen.getByText('· 1 full-length photo and your face photo')).toBeTruthy();
    expect(screen.getByText('· 48 AI images generated on you')).toBeTruthy();
    expect(screen.getByText('· Your colour palette analysis')).toBeTruthy();
    expect(screen.getByText("This can't be undone.")).toBeTruthy();

    // "Vazgeç" changes nothing.
    await fireEvent.press(screen.getByText('Cancel'));
    expect(screen.queryByText('Delete permanently')).toBeNull();
    expect(accountFixtures.photos().body).toHaveLength(1);

    await fireEvent.press(screen.getByText('Delete my photos and generated images'));
    await fireEvent.press(screen.getByText('Delete permanently'));
    await waitFor(() => expect(screen.queryByLabelText('Remove full-length photo')).toBeNull(), WAIT);
    await waitFor(() => expect(accountFixtures.photos()).toEqual({ body: [], face: null, generatedImageCount: 0 }), WAIT);
  });
});

describe('29c Silme onayı · hesap', () => {
  it('keeps the delete button off until the confirmation word is typed', async () => {
    await open('/delete-account');
    await waitFor(() => expect(screen.getByText('86 pieces and 24 looks')).toBeTruthy(), WAIT);
    expect(screen.getByText('ACCOUNT DELETION')).toBeTruthy();
    expect(screen.getByLabelText('Delete my account permanently')).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Type DELETE to confirm'), 'delete');
    expect(screen.getByLabelText('Delete my account permanently')).toBeEnabled();
    expect(screen.getByText('Cancel')).toBeTruthy();
  });
});

describe('30 Renk paletim', () => {
  it('shows the eight named tones and the four tones to avoid', async () => {
    await open('/palette');
    await waitFor(() => expect(screen.getByText('Warm Autumn')).toBeTruthy(), WAIT);
    ['Cinnamon', 'Caramel', 'Olive', 'Midnight blue', 'Sand', 'Burgundy', 'Cream', 'Espresso'].forEach((name) =>
      expect(screen.getByText(name)).toBeTruthy(),
    );
    expect(screen.getByTestId('palette-avoid').children).toHaveLength(4);
    expect(screen.getByLabelText('Icy white')).toBeTruthy();
    expect(screen.getByText('Products in my palette')).toBeTruthy();
  });

  it('PaletBos asks for the face photo and offers the camera or the library', async () => {
    resetAccountFixtures({ palette: 'none', facePhoto: false });
    await open('/palette');
    await waitFor(() => expect(screen.getByText('Upload a face photo first')).toBeTruthy(), WAIT);
    expect(screen.getByText('Your photo is visible only to you.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Upload face photo'));
    // Consents 2 + 6 are on record (fixture account): no consent sheet, the source sheet opens.
    await waitFor(() => expect(screen.getByText('Take a photo')).toBeTruthy(), WAIT);
    expect(screen.getByText('Choose from library')).toBeTruthy();
  });
});
