import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import * as WebBrowser from 'expo-web-browser';
import { Share } from 'react-native';

import { onboardingStore } from '@/auth/onboarding';
import { requirementsFlow } from '@/features/requirements/store';
import { accountFixtures, resetAccountFixtures } from '@/fixtures/account';
import { resetConsentFixtures } from '@/fixtures/consents';
import { resetFixtureDb } from '@/fixtures/db';
import { resetNotificationFixtures } from '@/fixtures/notifications';
import { resetStoreFixtures } from '@/fixtures/store';
import i18n from '@/i18n';

const mockSession = {
  accessToken: 'a',
  refreshToken: 'r',
  expiresAt: Date.now() + 3_600_000,
  user: { id: 'u1', name: 'Damla Kaya', email: 'damla@example.com', ageConfirmed: true },
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

const WAIT = { timeout: 5000 };

async function open(url: string) {
  await onboardingStore.markDone('u1');
  await renderRouter('./src/app', { initialUrl: url });
}

beforeEach(async () => {
  resetFixtureDb();
  resetStoreFixtures();
  resetAccountFixtures();
  resetConsentFixtures();
  resetNotificationFixtures();
  requirementsFlow.reset();
  await AsyncStorage.clear();
  await i18n.changeLanguage('en');
});

describe('E-mail verification', () => {
  it('Today shows the dismissible banner (the profile card leaves its e-mail row out meanwhile); the code screen verifies with auto-submit', async () => {
    resetAccountFixtures({ emailVerified: false });
    await open('/');
    await waitFor(() => expect(screen.getByTestId('today.verifyEmail')).toBeTruthy(), WAIT);
    await waitFor(() => expect(screen.getByTestId('today.profileComplete')).toBeTruthy(), WAIT);
    // Canvas "06 Bugün · e-posta doğrula + profilini tamamla": the banner carries the e-mail step, not the card.
    expect(screen.queryByTestId('today.profileComplete.item.verifyEmail')).toBeNull();

    await fireEvent.press(screen.getByTestId('today.verifyEmail.open'));
    await waitFor(() => expect(screen.getByTestId('verify.code')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('verify.submit')).toBeDisabled();
    // Six boxes; a wrong code clears the boxes and says why.
    expect(screen.getByTestId('verify.code.box.5')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('verify.code'), '111111');
    await waitFor(() => expect(screen.getByTestId('verify.error')).toHaveTextContent('The code or link is not valid. Try the one in the latest e-mail.'), WAIT);

    // Pasting "123 456" keeps the digits and submits by itself.
    await fireEvent.changeText(screen.getByTestId('verify.code'), '123 456');
    await waitFor(() => expect(screen.getByTestId('verify.done')).toBeTruthy(), WAIT);
    expect(accountFixtures.profile().emailVerified).toBe(true);
  });

  it('resend counts down from 60 seconds', async () => {
    resetAccountFixtures({ emailVerified: false });
    await open('/verify-email');
    await waitFor(() => expect(screen.getByTestId('verify.resend')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('verify.resend'));
    await waitFor(() => expect(screen.getByTestId('verify.sent')).toBeTruthy(), WAIT);
    expect(accountFixtures.verificationResends()).toBe(1);
    expect(screen.getByText(/Send again · (60|59) s/)).toBeTruthy();
    expect(screen.getByTestId('verify.resend')).toBeDisabled();
  });

  it('the e-mail link verifies on open', async () => {
    resetAccountFixtures({ emailVerified: false });
    await open('/verify-email?token=abc123token');
    await waitFor(() => expect(screen.getByTestId('verify.done')).toBeTruthy(), WAIT);
  });

  it('the banner hides for good with ×; a verified account never sees it', async () => {
    resetAccountFixtures({ emailVerified: false });
    await open('/');
    await waitFor(() => expect(screen.getByTestId('today.verifyEmail')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('today.verifyEmail.hide'));
    await waitFor(() => expect(screen.queryByTestId('today.verifyEmail')).toBeNull(), WAIT);
    expect(await AsyncStorage.getItem('droblet.verifyEmailBanner.u1')).toBe('1');
    // With the banner gone, the profile card carries the e-mail step again.
    await waitFor(() => expect(screen.getByTestId('today.profileComplete.item.verifyEmail')).toBeTruthy(), WAIT);
  });
});

describe('Verilerimi indir', () => {
  it('Settings › Privacy opens it; prepare → preparing → ready with a download and the next allowed time', async () => {
    await open('/settings');
    await waitFor(() => expect(screen.getByTestId('settings.dataExport')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('settings.dataExport'));
    await waitFor(() => expect(screen.getByTestId('dataExport.request')).toBeTruthy(), WAIT);
    expect(screen.getByText('One copy at a time, at most one request a day.')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('dataExport.request'));
    await waitFor(() => expect(screen.getByTestId('dataExport.preparing')).toBeTruthy(), WAIT);

  });

  it('a ready copy shows its size, until when, the next allowed request and downloads', async () => {
    accountFixtures.startDataExport();
    accountFixtures.completeDataExport();
    await open('/data-export');
    await waitFor(() => expect(screen.getByTestId('dataExport.ready')).toBeTruthy(), WAIT);
    expect(screen.getByText(/18,?\.?2 MB/)).toBeTruthy();
    expect(screen.getByTestId('dataExport.next')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('dataExport.download'));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://s3.test/exports/export_1.zip');
  });
});

describe('@handle gate on social actions', () => {
  it('follow without a handle opens the handle step, then sends the follow', async () => {
    resetAccountFixtures({ handle: null });
    await open('/friends/find');
    await waitFor(() => expect(screen.getByTestId('find.claimHandle')).toBeTruthy(), WAIT);
    const chip = await waitFor(() => screen.getAllByTestId(/^follow\./)[0]!, WAIT);
    await fireEvent.press(chip);
    await waitFor(() => expect(screen.getByTestId('requirements.step.handle')).toBeTruthy(), WAIT);
    await fireEvent.changeText(screen.getByTestId('requirements.handle.input'), 'damla_k');
    await waitFor(() => expect(screen.getByTestId('requirements.handle.save')).not.toBeDisabled(), WAIT);
    await fireEvent.press(screen.getByTestId('requirements.handle.save'));
    await waitFor(() => expect(accountFixtures.profile().handle).toBe('damla_k'), WAIT);
  });

  it('the invite link asks for the handle first; with a handle it shares at once', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    resetAccountFixtures({ handle: null });
    await open('/friends/find');
    await waitFor(() => expect(screen.getByTestId('find.claimHandle')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('find.invite'));
    await waitFor(() => expect(screen.getByTestId('requirements.step.handle')).toBeTruthy(), WAIT);
    expect(share).not.toHaveBeenCalled();
    share.mockRestore();
  });

  it('with a handle, sharing the invite link opens the share sheet directly', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    await open('/friends/find');
    await waitFor(() => expect(screen.getByTestId('find.invite')).toBeTruthy(), WAIT);
    expect(screen.queryByTestId('find.claimHandle')).toBeNull();
    await fireEvent.press(screen.getByTestId('find.invite'));
    await waitFor(() => expect(share).toHaveBeenCalled(), WAIT);
    expect(screen.queryByTestId('requirements.step.handle')).toBeNull();
    share.mockRestore();
  });
});

describe('Notification inbox paging', () => {
  it('loads older pages as the list is scrolled to the end', async () => {
    resetNotificationFixtures({ older: 40 });
    await open('/notifications');
    await waitFor(() => expect(screen.getByTestId('notifications-more')).toBeTruthy(), WAIT);
    expect(screen.queryByTestId('notification-notif_old_40')).toBeNull();
    await fireEvent.scroll(screen.getByTestId('notifications-list'), {
      nativeEvent: { contentOffset: { y: 3000 }, contentSize: { height: 3400 }, layoutMeasurement: { height: 800 } },
    });
    await waitFor(() => expect(screen.getByTestId('notification-notif_old_40')).toBeTruthy(), WAIT);
    expect(screen.queryByTestId('notifications-more')).toBeNull();
  });
});
