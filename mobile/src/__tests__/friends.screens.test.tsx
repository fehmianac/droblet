import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { resetAccountFixtures } from '@/fixtures/account';
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
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'cancel' })) }));
jest.mock('@/entitlement/useEntitlement', () => ({
  useEntitlement: () => ({
    data: { tier: 'member', credits: { monthlyAllowance: 30, remaining: 12, resetsAt: '2026-12-01T00:00:00.000Z' } },
    isError: false,
    isPending: false,
    refetch: jest.fn(),
  }),
}));

type ContactsMock = { requestPermissionsAsync: jest.Mock; getContactsAsync: jest.Mock };

const TIMEOUT = { timeout: 4000 };

async function open(url: string) {
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
  await renderRouter('./src/app', { initialUrl: url });
}

describe('friends: follow requests, lists, contacts, profile edit (fixtures, EN)', () => {
  beforeEach(async () => {
    resetStoreFixtures();
    resetSocialFixtures();
    resetAccountFixtures();
    jest.clearAllMocks();
    await AsyncStorage.clear();
    await i18n.changeLanguage('en');
  });

  it('26 following a followers-only closet sends a request; the closet stays locked', async () => {
    await open('/u/deniz');
    await waitFor(() => expect(screen.getByText('Follow')).toBeTruthy(), TIMEOUT);
    await fireEvent.press(screen.getByTestId('person.follow'));
    await waitFor(() => expect(screen.getByText('Requested')).toBeTruthy(), TIMEOUT);
    expect(screen.getByText('This closet is private')).toBeTruthy();
    // Tapping the pending request withdraws it.
    await fireEvent.press(screen.getByTestId('person.follow'));
    await waitFor(() => expect(screen.getByText('Follow')).toBeTruthy(), TIMEOUT);
  });

  it('26 a person who asked to follow me can be approved on their profile', async () => {
    await open('/u/elif');
    await waitFor(() => expect(screen.getByText('Elif wants to follow you')).toBeTruthy(), TIMEOUT);
    await fireEvent.press(screen.getByTestId('person.approve'));
    await waitFor(() => expect(screen.queryByText('Elif wants to follow you')).toBeNull(), TIMEOUT);
  });

  it('follow requests: approve an incoming one; the sent tab shows the empty state', async () => {
    await open('/friends/requests');
    await waitFor(() => expect(screen.getByText('Elif')).toBeTruthy(), TIMEOUT);
    await fireEvent.press(screen.getByTestId('requests.approve.elif'));
    await waitFor(() => expect(screen.getByText('No follow requests are waiting.')).toBeTruthy(), TIMEOUT);
    await fireEvent.press(screen.getByTestId('requests.tab.outgoing'));
    await waitFor(() => expect(screen.getByText('None of your requests are waiting for approval.')).toBeTruthy(), TIMEOUT);
  });

  it('followers list: removing a follower asks first', async () => {
    await open('/friends/followers');
    await waitFor(() => expect(screen.getByText('Selin')).toBeTruthy(), TIMEOUT);
    await fireEvent.press(screen.getByTestId('followers.remove.selin'));
    await waitFor(() => expect(screen.getByText(/Selin will no longer follow you/)).toBeTruthy(), TIMEOUT);
    await fireEvent.press(screen.getAllByText('Remove').at(-1)!);
    await waitFor(() => expect(screen.getByText('You have no followers yet.')).toBeTruthy(), TIMEOUT);
  });

  it('27 contacts: consent first, then the permission, then the matches', async () => {
    const contacts = jest.requireMock('expo-contacts/legacy') as ContactsMock;
    contacts.getContactsAsync.mockResolvedValueOnce({ data: [{ id: 'c1', emails: [{ email: 'Zeynep@Example.com' }] }] });
    await open('/friends/contacts');
    await waitFor(() => expect(screen.getByText(/Only these hashes are sent/)).toBeTruthy(), TIMEOUT);
    expect(contacts.requestPermissionsAsync).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('contacts.agree'));
    await waitFor(() => expect(screen.getByText('2 people from your contacts are on Droblet')).toBeTruthy(), TIMEOUT);
    expect(contacts.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Zeynep')).toBeTruthy();
  });

  it('27 contacts: a refused permission explains and offers Settings', async () => {
    const contacts = jest.requireMock('expo-contacts/legacy') as ContactsMock;
    contacts.requestPermissionsAsync.mockResolvedValueOnce({ status: 'denied', canAskAgain: false, granted: false });
    await open('/friends/contacts');
    await waitFor(() => expect(screen.getByTestId('contacts.agree')).toBeTruthy(), TIMEOUT);
    await fireEvent.press(screen.getByTestId('contacts.agree'));
    await waitFor(() => expect(screen.getByText('Contacts permission is off')).toBeTruthy(), TIMEOUT);
    expect(screen.getByText('Open Settings')).toBeTruthy();
    expect(contacts.getContactsAsync).not.toHaveBeenCalled();
  });

  it('profile edit: live @handle availability on the one edit-profile screen', async () => {
    await open('/edit-profile');
    await waitFor(() => expect(screen.getByText('This is your username.')).toBeTruthy(), TIMEOUT);
    await fireEvent.changeText(screen.getByTestId('profileEdit.handle'), 'selin');
    await waitFor(() => expect(screen.getByText('This username is taken.')).toBeTruthy(), TIMEOUT);
    expect(screen.getByTestId('profile-save')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('profileEdit.handle'), 'admin');
    await waitFor(() => expect(screen.getByText("This username can't be used.")).toBeTruthy(), TIMEOUT);
    await fireEvent.changeText(screen.getByTestId('profileEdit.handle'), 'damla.k');
    await waitFor(() => expect(screen.getByText('@damla.k is available.')).toBeTruthy(), TIMEOUT);
  });

  it('notifications: price drops and follow requests are check boxes, off by default', async () => {
    await open('/notifications');
    await waitFor(() => expect(screen.getByText('Price drops on my watch list')).toBeTruthy(), TIMEOUT);
    expect(screen.getByRole('checkbox', { name: 'Follow requests' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Price drops on my watch list' })).not.toBeChecked();
  });
});
