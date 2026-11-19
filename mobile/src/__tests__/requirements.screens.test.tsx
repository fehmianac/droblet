import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { CONSENT_TYPES } from '@/api/contracts/consents';
import { setBodyProfileFixture } from '@/api/profile';
import { onboardingStore } from '@/auth/onboarding';
import { resetConsentReviewHost } from '@/features/consent/ConsentReviewHost';
import { consentRequests } from '@/features/consent/store';
import { requirementsFlow } from '@/features/requirements/store';
import { accountFixtures, resetAccountFixtures } from '@/fixtures/account';
import { consentFixtures, resetConsentFixtures } from '@/fixtures/consents';
import { resetFixtureDb } from '@/fixtures/db';
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

async function open(url: string, onboarding: 'done' | 'pending' = 'done') {
  await (onboarding === 'done' ? onboardingStore.markDone('u1') : onboardingStore.markPending('u1'));
  await renderRouter('./src/app', { initialUrl: url });
}

beforeEach(async () => {
  resetFixtureDb();
  resetAccountFixtures();
  resetConsentFixtures();
  setBodyProfileFixture(null);
  consentRequests.settle(false);
  requirementsFlow.reset();
  resetConsentReviewHost();
  await AsyncStorage.clear();
  await i18n.changeLanguage('en');
});

describe('Onboarding 2 / 4 — every consent on one screen (owner decision 1)', () => {
  it('shows all seven consents unticked with a summary each; "Accept all" records every one and continues to 04', async () => {
    resetConsentFixtures({ granted: [], undecided: [...CONSENT_TYPES] });
    await open('/consents', 'pending');
    await waitFor(() => expect(screen.getByTestId('onboarding.consents')).toBeTruthy(), WAIT);
    expect(screen.getByText('2 / 4')).toBeTruthy();
    for (const type of CONSENT_TYPES) expect(screen.getByTestId(`consent.check.${type}`)).not.toBeChecked();
    expect(screen.getByText('Face photo and “See it on me”')).toBeTruthy();
    expect(screen.getByText('To create images of you from your face and the body type you choose, when you have no full-length photo.')).toBeTruthy();
    expect(screen.getByText('0 of 7 selected')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('consents.acceptAll'));
    await waitFor(() => expect(screen).toHavePathname('/body'), WAIT);
    const request = consentFixtures.requests()[0];
    expect(request?.source).toBe('onboarding');
    expect(request?.consents).toHaveLength(7);
    expect(request?.consents.every((c) => c.granted && c.version === '2026-11-19')).toBe(true);
    expect(CONSENT_TYPES.every((type) => consentFixtures.isValid(type))).toBe(true);
  });

  it('"Continue with my choices" grants the ticked ones and records the others as declined', async () => {
    resetConsentFixtures({ granted: [], undecided: [...CONSENT_TYPES] });
    await open('/consents', 'pending');
    await waitFor(() => expect(screen.getByTestId('onboarding.consents')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('consent.check.bodyPhotoAi'));
    await fireEvent.press(screen.getByTestId('consent.check.crossBorderTransfer'));
    await waitFor(() => expect(screen.getByText('2 of 7 selected')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('consents.continueSelected'));
    await waitFor(() => expect(screen).toHavePathname('/body'), WAIT);
    const decisions = Object.fromEntries((consentFixtures.requests()[0]?.consents ?? []).map((c) => [c.type, c.granted]));
    expect(decisions).toEqual({
      bodyPhotoAi: true,
      facePhotoPalette: false,
      weight: false,
      contacts: false,
      marketingNotifications: false,
      crossBorderTransfer: true,
      facePhotoTryOn: false,
    });
    expect(consentFixtures.isValid('facePhotoTryOn')).toBe(false);
  });

  it('an existing account with a never-answered consent sees the screen once on the next app open', async () => {
    resetConsentFixtures({ undecided: ['facePhotoTryOn'] });
    await open('/');
    await waitFor(() => expect(screen.getByTestId('onboarding.consents')).toBeTruthy(), WAIT);
    expect(screen.getByText('Our consent texts have changed')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('consents.acceptAll'));
    await waitFor(() => expect(screen.queryByTestId('onboarding.consents')).toBeNull(), WAIT);
    expect(consentFixtures.isValid('facePhotoTryOn')).toBe(true);
  });
});

describe('Canvas 11 — requirements flow on "See it on me"', () => {
  it('face path: hint → sheet (two photo paths) → consent → body type → "Ready" → the try-on resumes on the same look', async () => {
    accountFixtures.removePhoto('body', 'photo_body_1');
    resetConsentFixtures({ granted: CONSENT_TYPES.filter((type) => type !== 'facePhotoTryOn') });
    await open('/look/look_lacivert_blazer');
    await waitFor(() => expect(screen.getByTestId('look-try-on-hint')).toBeTruthy(), WAIT);
    expect(screen.getByText('Your full-length photo is needed · 1 step')).toBeTruthy();
    expect(screen.getByTestId('requirements.badge')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('look-try-on'));
    await waitFor(() => expect(screen.getByTestId('requirements.sheet')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('requirements.path.body').props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByTestId('requirements.path.face'));
    await waitFor(() => expect(screen.getByText('2 steps left to see it on you')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('requirements.sheet.start'));

    // Step 1 / 2: the new purpose — its own unticked box.
    await waitFor(() => expect(screen.getByTestId('requirements.step.consent')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('requirements.stepper.count')).toHaveTextContent('1 / 2');
    expect(screen.getByTestId('consent.check.facePhotoTryOn')).not.toBeChecked();
    await fireEvent.press(screen.getByTestId('consent.check.facePhotoTryOn'));
    await fireEvent.press(screen.getByTestId('requirements.consent.confirm'));

    // Step 2 / 2: body type with height and size (no body profile yet).
    await waitFor(() => expect(screen.getByTestId('requirements.step.bodyType')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('requirements.stepper.count')).toHaveTextContent('2 / 2');
    await fireEvent.press(screen.getByTestId('requirements.bodyType.pear'));
    expect(screen.getByText(/Hips wider than the shoulders/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('requirements.bodyType.save'));
    await waitFor(() => expect(screen.getByText('Enter a height between 100 and 230 cm.')).toBeTruthy(), WAIT);
    await fireEvent.changeText(screen.getByTestId('requirements.bodyType.height'), '168');
    await fireEvent.press(screen.getByTestId('requirements.bodyType.save'));

    await waitFor(() => expect(screen.getByTestId('requirements.ready')).toBeTruthy(), WAIT);
    expect(screen.getByText('Body type chosen')).toBeTruthy();
    // Back on the look by itself: the credit confirmation of the try-on.
    await waitFor(() => expect(screen.getByText('1 credit will be used')).toBeTruthy(), WAIT);
    expect(consentFixtures.requests()[0]).toMatchObject({ source: 'requirements', consents: [{ type: 'facePhotoTryOn', granted: true }] });
  });

  it('leaving mid-flow asks first, keeps what was done and the hint then says what is left', async () => {
    accountFixtures.removePhoto('body', 'photo_body_1');
    resetConsentFixtures({ granted: CONSENT_TYPES.filter((type) => type !== 'facePhotoTryOn') });
    await open('/look/look_lacivert_blazer');
    await waitFor(() => expect(screen.getByTestId('look-try-on-hint')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('look-try-on'));
    await waitFor(() => expect(screen.getByTestId('requirements.path.face')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('requirements.path.face'));
    await fireEvent.press(screen.getByTestId('requirements.sheet.start'));
    await waitFor(() => expect(screen.getByTestId('requirements.step.consent')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('consent.check.facePhotoTryOn'));
    await fireEvent.press(screen.getByTestId('requirements.consent.confirm'));
    await waitFor(() => expect(screen.getByTestId('requirements.step.bodyType')).toBeTruthy(), WAIT);

    await fireEvent.press(screen.getByTestId('requirements.stepper.close'));
    await waitFor(() => expect(screen.getByTestId('requirements.exit')).toBeTruthy(), WAIT);
    expect(screen.getByText('Leave for now?')).toBeTruthy();
    expect(screen.getByText('Consent given')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('requirements.exit.leave'));
    await waitFor(() => expect(screen.queryByTestId('requirements.stepper')).toBeNull(), WAIT);
    await waitFor(() => expect(screen.getByText('Your body type is needed · 1 step left')).toBeTruthy(), WAIT);
    expect(consentFixtures.isValid('facePhotoTryOn')).toBe(true);
  });
});

describe('"Complete your profile" card', () => {
  it('counts the six items on Profile, opens an item as its own step and collapses to one row', async () => {
    accountFixtures.removePhoto('body', 'photo_body_1');
    await open('/profile');
    await waitFor(() => expect(screen.getByTestId('profile.profileComplete')).toBeTruthy(), WAIT);
    // Done: face photo, city, @handle, first 5 pieces; open: full-length photo, body type.
    expect(screen.getByText('COMPLETE YOUR PROFILE · 4 / 6')).toBeTruthy();
    expect(screen.getByTestId('profile.profileComplete.item.bodyPhoto')).toBeTruthy();
    expect(screen.getByTestId('profile.profileComplete.item.bodyType')).toBeTruthy();
    expect(screen.queryByTestId('profile.profileComplete.item.handle')).toBeNull();

    await fireEvent.press(screen.getByTestId('profile.profileComplete.item.bodyType'));
    await waitFor(() => expect(screen.getByTestId('requirements.step.bodyType')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('requirements.stepper.close'));
    await waitFor(() => expect(screen.getByTestId('requirements.exit.leave')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('requirements.exit.leave'));

    await fireEvent.press(screen.getByTestId('profile.profileComplete.hide'));
    await waitFor(() => expect(screen.getByTestId('profile.profileComplete.collapsed')).toBeTruthy(), WAIT);
    expect(screen.getByLabelText('Complete your profile, 4 / 6')).toBeTruthy();
    expect(await AsyncStorage.getItem('droblet.profileCard.u1')).toBe('collapsed');
  });
});
