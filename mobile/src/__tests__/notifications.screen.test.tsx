import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { resetAccountFixtures } from '@/fixtures/account';
import { resetFixtureDb } from '@/fixtures/db';
import { notificationFixtures, resetNotificationFixtures } from '@/fixtures/notifications';
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

const WAIT = { timeout: 4000 };

async function open(url: string) {
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
  await renderRouter('./src/app', { initialUrl: url });
}

const isRead = (id: string) => notificationFixtures.list().items.find((n) => n.id === id)?.readAt !== null;

beforeEach(async () => {
  resetFixtureDb();
  resetStoreFixtures();
  resetAccountFixtures();
  resetNotificationFixtures();
  await AsyncStorage.clear();
  await i18n.changeLanguage('en');
});

describe('Bildirim merkezi (derived)', () => {
  it('lists the notifications grouped by day with their unread state', async () => {
    await open('/notifications');
    await waitFor(() => expect(screen.getByText('TODAY')).toBeTruthy(), WAIT);
    expect(screen.getByText('YESTERDAY')).toBeTruthy();
    expect(screen.getByText('3 unread notifications')).toBeTruthy();
    expect(screen.getByText(/^Price drop on /)).toBeTruthy();
    expect(screen.getByText(/^Marks & Spencer · .*, was /)).toBeTruthy();
    expect(screen.getByText('Selin gave your look 5 stars')).toBeTruthy();
    expect(screen.getByText('Your weekly plan is ready')).toBeTruthy();
    expect(screen.getByText('3 AI images left this month')).toBeTruthy();
    expect(screen.getByText(/^Your membership renews on /)).toBeTruthy();
    // Unread rows carry the dot; read ones do not.
    expect(screen.getByTestId('unread-notif_1')).toBeTruthy();
    expect(screen.queryByTestId('unread-notif_4')).toBeNull();
    expect(screen.getByLabelText(/^Unread\. Selin gave your look 5 stars\./)).toBeTruthy();
  });

  it('"Tümünü okundu say" marks everything read at once', async () => {
    await open('/notifications');
    await waitFor(() => expect(screen.getByText('Mark all as read')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByText('Mark all as read'));
    await waitFor(() => expect(screen.getByText('All read')).toBeTruthy(), WAIT);
    expect(screen.queryByText('Mark all as read')).toBeNull();
    expect(screen.queryByTestId('unread-notif_1')).toBeNull();
    await waitFor(() => expect(isRead('notif_1') && isRead('notif_2') && isRead('notif_3')).toBe(true), WAIT);
  });

  it('a notification marks itself read and opens its subject', async () => {
    await open('/notifications');
    await waitFor(() => expect(screen.getByText('Your weekly plan is ready')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('notification-notif_3'));
    await waitFor(() => expect(screen.getByText('Weekly plan')).toBeTruthy(), WAIT);
    await waitFor(() => expect(isRead('notif_3')).toBe(true), WAIT);
    expect(isRead('notif_1')).toBe(false);
  });

  it('the price drop opens the product', async () => {
    await open('/notifications');
    await waitFor(() => expect(screen.getByText(/^Price drop on /)).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('notification-notif_1'));
    await waitFor(() => expect(screen.getByText('Add to cart')).toBeTruthy(), WAIT);
  });

  it('empty: one sentence and one action, which opens the notification settings on 29', async () => {
    resetNotificationFixtures({ empty: true });
    await open('/notifications');
    await waitFor(() => expect(screen.getByText('No notifications yet; price drops and friend ratings will appear here.')).toBeTruthy(), WAIT);
    expect(screen.queryByText('Mark all as read')).toBeNull();
    await fireEvent.press(screen.getByText('Notification settings'));
    await waitFor(() => expect(screen.getByText('NOTIFICATIONS')).toBeTruthy(), WAIT);
  });

  it('the bell on 06 Bugün opens the notification centre', async () => {
    await open('/');
    await waitFor(() => expect(screen.getByLabelText('Notifications')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByLabelText('Notifications'));
    await waitFor(() => expect(screen.getByText('TODAY')).toBeTruthy(), WAIT);
  });
});
