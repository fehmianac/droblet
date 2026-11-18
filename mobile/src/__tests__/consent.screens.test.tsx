import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { accountFixtures, resetAccountFixtures } from '@/fixtures/account';
import { consentFixtures, resetConsentFixtures } from '@/fixtures/consents';
import { resetFixtureDb } from '@/fixtures/db';
import { resetNotificationFixtures } from '@/fixtures/notifications';
import { resetStoreFixtures } from '@/fixtures/store';
import { consentRequests } from '@/features/consent/store';
import i18n from '@/i18n';
import { onboardingStore } from '@/auth/onboarding';

const mockSession = {
  accessToken: 'a',
  refreshToken: 'r',
  expiresAt: Date.now() + 3_600_000,
  user: { id: 'u1', name: 'Damla', email: 'damla@example.com', ageConfirmed: true },
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

async function open(url: string, onboarding: 'done' | 'pending' = 'done') {
  // The onboarding store caches per user in memory: set it, not only the stored value.
  await (onboarding === 'done' ? onboardingStore.markDone('u1') : onboardingStore.markPending('u1'));
  await renderRouter('./src/app', { initialUrl: url });
}

beforeEach(async () => {
  resetFixtureDb();
  resetStoreFixtures();
  resetAccountFixtures();
  resetNotificationFixtures();
  resetConsentFixtures({ granted: [] });
  consentRequests.settle(false);
  await AsyncStorage.clear();
  await i18n.changeLanguage('en');
});

/** Ticks the given consent boxes on the open sheet and presses "I agree". */
async function agreeTo(types: string[]) {
  for (const type of types) await fireEvent.press(screen.getByTestId(`consent.check.${type}`));
  await fireEvent.press(screen.getByTestId('consent.agree'));
}

describe('Açık rıza — just in time', () => {
  it('try-on: body photo + transfer consents (two unticked boxes, both required) come before the credit confirmation', async () => {
    await open('/look/look_lacivert_blazer');
    await waitFor(() => expect(screen.getByTestId('look-try-on')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('look-try-on'));
    await waitFor(() => expect(screen.getByTestId('consent-sheet')).toBeTruthy(), WAIT);
    expect(screen.getByText('Full-body photo and “See it on me”')).toBeTruthy();
    expect(screen.getByText('Transfers abroad')).toBeTruthy();
    // The exact consent statements, never pre-ticked; one box alone is not enough.
    expect(screen.getByTestId('consent.check.bodyPhotoAi')).not.toBeChecked();
    expect(screen.getByTestId('consent.check.crossBorderTransfer')).not.toBeChecked();
    expect(screen.getByText(/I give my explicit consent to Droblet Ltd processing my full-body photo/)).toBeTruthy();
    expect(screen.getByTestId('consent.agree')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('consent.check.bodyPhotoAi'));
    expect(screen.getByTestId('consent.agree')).toBeDisabled();
    // The full text is readable before agreeing.
    await fireEvent.press(screen.getByTestId('consent.more.bodyPhotoAi'));
    expect(screen.getByText(/^Purpose: to generate images that show outfits/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('consent.check.crossBorderTransfer'));
    await fireEvent.press(screen.getByTestId('consent.agree'));

    await waitFor(() => expect(screen.getByText('1 credit will be used')).toBeTruthy(), WAIT);
    expect(consentFixtures.isValid('bodyPhotoAi') && consentFixtures.isValid('crossBorderTransfer')).toBe(true);
    expect(consentFixtures.requests()[0]).toEqual({
      consents: [
        { type: 'bodyPhotoAi', granted: true, version: '2026-11-19' },
        { type: 'crossBorderTransfer', granted: true, version: '2026-11-19' },
      ],
      source: 'tryon',
      locale: 'en',
    });
  });

  it('try-on: "Not now" starts nothing and spends nothing', async () => {
    await open('/look/look_lacivert_blazer');
    await waitFor(() => expect(screen.getByTestId('look-try-on')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('look-try-on'));
    await waitFor(() => expect(screen.getByTestId('consent.notNow')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('consent.notNow'));
    await waitFor(() => expect(screen.queryByTestId('consent-sheet')).toBeNull(), WAIT);
    expect(screen.queryByText('1 credit will be used')).toBeNull();
    expect(consentFixtures.requests()).toHaveLength(0);
  });

  it('try-on: consents already given → straight to the credit confirmation', async () => {
    resetConsentFixtures();
    await open('/look/look_lacivert_blazer');
    await waitFor(() => expect(screen.getByTestId('look-try-on')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('look-try-on'));
    await waitFor(() => expect(screen.getByText('1 credit will be used')).toBeTruthy(), WAIT);
    expect(screen.queryByTestId('consent-sheet')).toBeNull();
  });

  it('face photo / palette: face consent, and the transfer consent only when it is not given yet', async () => {
    resetAccountFixtures({ palette: 'none', facePhoto: false });
    resetConsentFixtures({ granted: ['crossBorderTransfer'] });
    await open('/palette');
    await waitFor(() => expect(screen.getByText('Upload face photo')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByText('Upload face photo'));
    await waitFor(() => expect(screen.getByTestId('consent-sheet')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('consent.block.facePhotoPalette')).toBeTruthy();
    expect(screen.queryByTestId('consent.block.crossBorderTransfer')).toBeNull();
    expect(screen.getByText(/only for colour palette analysis and without identifying me/)).toBeTruthy();
    await agreeTo(['facePhotoPalette']);
    await waitFor(() => expect(screen.getByText('Take a photo')).toBeTruthy(), WAIT);
    expect(consentFixtures.isValid('facePhotoPalette')).toBe(true);
  });

  it('body photo in Ayarlar asks for consents 1 + 6 before the camera', async () => {
    await open('/settings');
    await waitFor(() => expect(screen.getByLabelText('Add photo')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByLabelText('Add photo'));
    await fireEvent.press(screen.getByText('Take a full-length photo'));
    await waitFor(() => expect(screen.getByTestId('consent.block.bodyPhotoAi')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('consent.block.crossBorderTransfer')).toBeTruthy();
  });

  it('a 403 consent_required from the server opens the sheet for exactly the missing consents', async () => {
    const { consentRequests } = jest.requireActual<typeof import('@/features/consent/store')>('@/features/consent/store');
    const { ApiError } = jest.requireActual<typeof import('@/api/errors')>('@/api/errors');
    const { getActiveQueryClient } = jest.requireActual<typeof import('@/sync/activeClient')>('@/sync/activeClient');
    await open('/settings');
    await waitFor(() => expect(screen.getByLabelText('Add photo')).toBeTruthy(), WAIT);
    const client = getActiveQueryClient();
    const failing = client?.getMutationCache().build(client, {
      mutationFn: () => Promise.reject(new ApiError('http', 403, { status: 403, code: 'consent_required', missing: ['contacts'] })),
    });
    await failing?.execute(undefined).catch(() => undefined);
    await waitFor(() => expect(consentRequests.get()?.types).toEqual(['contacts']), WAIT);
    await waitFor(() => expect(screen.getByTestId('consent.block.contacts')).toBeTruthy(), WAIT);
  });
});

describe('Kilo — explicit consent 3', () => {
  it('without consent the weight field is disabled with a note; giving consent enables it', async () => {
    await open('/body', 'pending');
    await waitFor(() => expect(screen.getByTestId('body.weightConsent')).toBeTruthy(), WAIT);
    expect(screen.getByText('Weight is optional. Entering it needs a separate explicit consent.')).toBeTruthy();
    expect(screen.getByTestId('body.weight').props.editable).toBe(false);
    await fireEvent.press(screen.getByTestId('body.weightGive'));
    await waitFor(() => expect(screen.getByTestId('consent.block.weight')).toBeTruthy(), WAIT);
    await agreeTo(['weight']);
    await waitFor(() => expect(screen.getByTestId('body.weight').props.editable).toBe(true), WAIT);
    expect(screen.queryByTestId('body.weightConsent')).toBeNull();
  });
});

describe('Pazarlama bildirimleri — explicit consent 5', () => {
  it('the weekly edit is off by default; switching it on shows the consent first', async () => {
    await open('/notifications');
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Edit of the week' })).toBeTruthy(), WAIT);
    expect(screen.getByRole('checkbox', { name: 'Edit of the week' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Morning outfit reminder' })).toBeChecked();
    await waitFor(() => expect(screen.getByTestId('notifications.marketingNote')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Edit of the week' }));
    await waitFor(() => expect(screen.getByTestId('consent.block.marketingNotifications')).toBeTruthy(), WAIT);
    await agreeTo(['marketingNotifications']);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Edit of the week' })).toBeChecked(), WAIT);
    expect(consentFixtures.requests()[0]?.source).toBe('notifications');
    await waitFor(() => expect(accountFixtures.notifications().weeklyEdit).toBe(true), WAIT);
  });

  it('declining leaves the weekly edit off', async () => {
    await open('/notifications');
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Edit of the week' })).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Edit of the week' }));
    await waitFor(() => expect(screen.getByTestId('consent.notNow')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('consent.notNow'));
    await waitFor(() => expect(screen.queryByTestId('consent-sheet')).toBeNull(), WAIT);
    expect(screen.getByRole('checkbox', { name: 'Edit of the week' })).not.toBeChecked();
    expect(accountFixtures.notifications().weeklyEdit).toBe(false);
  });

  it('the one opt-in card on Bugün: "Yes" records the consent and switches the weekly edit on', async () => {
    await open('/');
    await waitFor(() => expect(screen.getByTestId('marketing-opt-in')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('marketing-opt-in.yes'));
    await waitFor(() => expect(screen.getByTestId('consent.block.marketingNotifications')).toBeTruthy(), WAIT);
    await agreeTo(['marketingNotifications']);
    await waitFor(() => expect(screen.queryByTestId('marketing-opt-in')).toBeNull(), WAIT);
    await waitFor(() => expect(accountFixtures.notifications().weeklyEdit).toBe(true), WAIT);
    expect(consentFixtures.requests()[0]?.source).toBe('marketing_card');
    expect(await AsyncStorage.getItem('droblet.marketingOptIn.u1')).toBe('done');
  });

  it('"No, thanks" hides the card for good without a consent', async () => {
    await open('/');
    await waitFor(() => expect(screen.getByTestId('marketing-opt-in')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('marketing-opt-in.no'));
    await waitFor(() => expect(screen.queryByTestId('marketing-opt-in')).toBeNull(), WAIT);
    expect(consentFixtures.requests()).toHaveLength(0);
    expect(await AsyncStorage.getItem('droblet.marketingOptIn.u1')).toBe('done');
  });
});

describe('Ayarlar › Gizlilik — withdrawal', () => {
  it('lists every consent with its state; switching body photo off records it and offers to delete the photo', async () => {
    resetConsentFixtures({ granted: ['bodyPhotoAi', 'crossBorderTransfer', 'contacts'] });
    await open('/settings');
    await waitFor(() => expect(screen.getByTestId('consent-list')).toBeTruthy(), WAIT);
    expect(screen.getByText('MY CONSENTS')).toBeTruthy();
    for (const type of ['bodyPhotoAi', 'facePhotoPalette', 'weight', 'contacts', 'marketingNotifications', 'crossBorderTransfer']) {
      expect(screen.getByTestId(`consent.row.${type}`)).toBeTruthy();
    }
    expect(screen.getByTestId('consent.state.bodyPhotoAi').props.children).toMatch(/^Given on /);
    expect(screen.getByTestId('consent.state.weight').props.children).toBe('Not given');
    expect(screen.getByTestId('consent.row.bodyPhotoAi')).toBeChecked();

    await fireEvent.press(screen.getByTestId('consent.row.bodyPhotoAi'));
    await waitFor(() => expect(screen.getByTestId('consent.withdrawOffer')).toBeTruthy(), WAIT);
    expect(consentFixtures.isValid('bodyPhotoAi')).toBe(false);
    expect(consentFixtures.requests()[0]).toEqual(
      expect.objectContaining({ source: 'settings', consents: [{ type: 'bodyPhotoAi', granted: false, version: '2026-11-19' }] }),
    );
    await waitFor(() => expect(screen.getByTestId('consent.state.bodyPhotoAi').props.children).toMatch(/^Withdrawn on /), WAIT);

    await fireEvent.press(screen.getByTestId('consent.deletePhotos'));
    await waitFor(() => expect(accountFixtures.photos().body).toHaveLength(0), WAIT);
    // The face photo is a separate consent and stays.
    expect(accountFixtures.photos().face).not.toBeNull();
  });

  it('switching a consent on from the list shows its text first', async () => {
    await open('/settings');
    await waitFor(() => expect(screen.getByTestId('consent.row.weight')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('consent.row.weight'));
    await waitFor(() => expect(screen.getByTestId('consent.block.weight')).toBeTruthy(), WAIT);
    await agreeTo(['weight']);
    await waitFor(() => expect(screen.getByTestId('consent.row.weight')).toBeChecked(), WAIT);
  });
});
