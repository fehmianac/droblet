import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { AccessibilityInfo } from 'react-native';

import type { AppSegment, StyleProfile } from '@/api/contracts';
import { onboardingStore } from '@/auth/onboarding';
import { segmentStore } from '@/features/segment/store';
import i18n from '@/i18n';

const mockSession = {
  accessToken: 'a',
  refreshToken: 'r',
  expiresAt: Date.now() + 3_600_000,
  user: { id: 'u1', name: 'Emre', email: 'emre@example.com' },
};

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => JSON.stringify(mockSession)),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  AFTER_FIRST_UNLOCK: 0,
}));
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

// Server configuration: which segments are open (`GET v1/config` → `segments.available`).
const mockSegments: { list: AppSegment[] } = { list: ['women'] };
jest.mock('@/features/segment/useAvailableSegments', () => ({
  useAvailableSegments: () => ({ segments: mockSegments.list, choice: mockSegments.list.length > 1, loading: false }),
}));

// The saved style profile (null = none yet) and what "Kaydet" / 03 send.
const mockStyle: { data: StyleProfile | null; saved: StyleProfile[] } = { data: null, saved: [] };
jest.mock('@/api/profile', () => {
  const actual = jest.requireActual('@/api/profile');
  return {
    ...actual,
    useStyleProfile: () => ({ data: mockStyle.data, isPending: false, isError: false, status: 'success' }),
    useSaveStyleProfile: () => ({ save: (p: StyleProfile) => mockStyle.saved.push(p), isPending: false }),
  };
});

const WAIT = { timeout: 6000 };

async function openOnboarding(url = '/') {
  await onboardingStore.markPending('u1');
  await renderRouter('./src/app', { initialUrl: url });
}
async function openSignedIn(url: string) {
  await AsyncStorage.removeItem('droblet.query.u1');
  await onboardingStore.markDone('u1');
  await renderRouter('./src/app', { initialUrl: url });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await i18n.changeLanguage('en');
  mockSegments.list = ['women'];
  mockStyle.data = null;
  mockStyle.saved = [];
});
afterEach(() => segmentStore.reset());

describe('03a Reyon — onboarding segment choice', () => {
  it('is skipped while only one segment is open: onboarding starts on 03 with the women tags', async () => {
    await openOnboarding();
    await waitFor(() => expect(screen.getByText("Let's get to know you")).toBeTruthy(), WAIT);
    expect(screen.queryByTestId('segment.screen')).toBeNull();
    expect(screen).toHavePathname('/style');
    expect(screen.getByTestId('style.tags.women')).toBeTruthy();
    expect(screen.getByTestId('style.tag.boho')).toBeTruthy();
    expect(screen.queryByTestId('style.tag.smart_casual')).toBeNull();
  });

  it('comes before 03 when two are open: no default, no "Continue"; tapping Men opens 03 with the men tags', async () => {
    mockSegments.list = ['women', 'men'];
    await openOnboarding();
    await waitFor(() => expect(screen.getByTestId('segment.screen')).toBeTruthy(), WAIT);
    expect(screen.getByText('Which department should we style you from?')).toBeTruthy();
    expect(screen.getByText("This only shapes your suggestions; it isn't shown on your profile or shared with anyone. You can add anything to your wardrobe.")).toBeTruthy();
    expect(screen.getByTestId('segment.option.women').props.accessibilityState).toMatchObject({ selected: false });
    expect(screen.getByTestId('segment.option.men').props.accessibilityState).toMatchObject({ selected: false });
    expect(screen.getByTestId('segment.option.men').props.accessibilityRole).toBe('button');
    expect(screen.queryByTestId('segment.continue')).toBeNull();

    // UX turu 2 · 11a: the tapped card shows its selected state, then 03 opens by itself (~250 ms).
    await fireEvent.press(screen.getByTestId('segment.option.men'));
    expect(screen.getByTestId('segment.option.men').props.accessibilityState).toMatchObject({ selected: true });

    await waitFor(() => expect(screen.getByText("Let's get to know you")).toBeTruthy(), WAIT);
    expect(segmentStore.get()).toBe('men');
    expect(screen.getByTestId('style.tags.men')).toBeTruthy();
    expect(screen.getByText('Smart casual')).toBeTruthy();
    expect(screen.getByText('Tailored')).toBeTruthy();
    expect(screen.queryByTestId('style.tag.boho')).toBeNull();

    for (const tag of ['minimal', 'smart_casual', 'tailored']) await fireEvent.press(screen.getByTestId(`style.tag.${tag}`));
    await fireEvent.press(screen.getByTestId('style.budget.mixed'));
    await fireEvent.press(screen.getByTestId('style.continue'));
    await waitFor(() => expect(mockStyle.saved).toHaveLength(1), WAIT);
    expect(mockStyle.saved[0]).toMatchObject({ segment: 'men', styleTags: ['minimal', 'smart_casual', 'tailored'], budget: 'mixed' });
  });

  it('starts from the saved segment of a returning account', async () => {
    mockSegments.list = ['women', 'men'];
    mockStyle.data = { segment: 'men', styleTags: ['minimal', 'tailored', 'street'], budget: 'mixed', baseVersion: 2 };
    await openOnboarding();
    await waitFor(() => expect(screen.getByTestId('segment.screen')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('segment.option.men').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen).toHavePathname('/segment');
  });

  it('with reduce motion on, a tap opens 03 at once', async () => {
    mockSegments.list = ['women', 'men'];
    // The React Native jest setup already mocks it: restore its implementation, not the (missing) original.
    const original = AccessibilityInfo.isReduceMotionEnabled;
    AccessibilityInfo.isReduceMotionEnabled = jest.fn(async () => true);
    try {
      await openOnboarding();
      await waitFor(() => expect(screen.getByTestId('segment.screen')).toBeTruthy(), WAIT);
      await fireEvent.press(screen.getByTestId('segment.option.women'));
      expect(screen).toHavePathname('/style');
      expect(segmentStore.get()).toBe('women');
    } finally {
      AccessibilityInfo.isReduceMotionEnabled = original;
    }
  });

  it('22b: each card shows its welcome photo instead of a silhouette', async () => {
    mockSegments.list = ['women', 'men'];
    await openOnboarding();
    await waitFor(() => expect(screen.getByTestId('segment.screen')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('segment.photo.women')).toBeTruthy();
    expect(screen.getByTestId('segment.photo.men')).toBeTruthy();
    expect(screen.queryByTestId('silhouette-women')).toBeNull();
    expect(screen.queryByTestId('silhouette-men')).toBeNull();
    expect(screen.getByLabelText("Women, Women's collections")).toBeTruthy();
  });
});

describe('22a Üyelik — the hero photo follows the segment', () => {
  it('women (and no segment yet): the women photo with the "See it on you first" badge', async () => {
    await openSignedIn('/paywall');
    await waitFor(() => expect(screen.getByTestId('paywall.hero.women')).toBeTruthy(), WAIT);
    expect(screen.queryByTestId('paywall.hero.men')).toBeNull();
    expect(screen.getByText('See it on you first')).toBeTruthy();
    expect(screen.queryByTestId('silhouette-women')).toBeNull();
  });

  it('men: the men photo', async () => {
    mockSegments.list = ['women', 'men'];
    mockStyle.data = { segment: 'men', styleTags: ['minimal', 'tailored', 'street'], budget: 'mixed', baseVersion: 2 };
    await openSignedIn('/paywall');
    await waitFor(() => expect(screen.getByTestId('paywall.hero.men')).toBeTruthy(), WAIT);
    expect(screen.queryByTestId('paywall.hero.women')).toBeNull();
  });
});

describe('28f Profil › Stil profili', () => {
  it('Profil lists "Style profile"; the segment shows only when two are open', async () => {
    mockSegments.list = ['women', 'men'];
    mockStyle.data = { segment: 'women', styleTags: ['minimal', 'classic', 'boho'], budget: 'mixed', baseVersion: 3 };
    await openSignedIn('/profile');
    await waitFor(() => expect(screen.getByTestId('profile.styleProfile')).toBeTruthy(), WAIT);
    expect(screen.getByText('Style profile')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('Women').length).toBeGreaterThan(0), WAIT);
  });

  it('has no segment row while only one segment is open', async () => {
    mockStyle.data = { segment: 'women', styleTags: ['minimal', 'classic', 'boho'], budget: 'mixed', baseVersion: 3 };
    await openSignedIn('/style-profile');
    await waitFor(() => expect(screen.getByTestId('styleProfile.screen')).toBeTruthy(), WAIT);
    expect(screen.queryByTestId('styleProfile.segmentRow')).toBeNull();
    expect(screen.getByTestId('styleProfile.tags.women')).toBeTruthy();
  });

  it('changing the segment asks first, keeps the wardrobe, clears the other set of tags and saves the men profile', async () => {
    mockSegments.list = ['women', 'men'];
    mockStyle.data = { segment: 'women', styleTags: ['minimal', 'classic', 'boho'], budget: 'mixed', baseVersion: 3 };
    await openSignedIn('/style-profile');
    await waitFor(() => expect(screen.getByTestId('styleProfile.segmentRow')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('styleProfile.segment.women').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('styleProfile.save').props.accessibilityState).toMatchObject({ disabled: true });

    await fireEvent.press(screen.getByTestId('styleProfile.segment.men'));
    await waitFor(() => expect(screen.getByTestId('styleProfile.confirm')).toBeTruthy(), WAIT);
    expect(screen.getByText('Switch to Men?')).toBeTruthy();
    expect(screen.getByText('Suggestions and the ready-made library change with it; your wardrobe stays the same.')).toBeTruthy();

    // "Cancel" changes nothing.
    await fireEvent.press(screen.getByTestId('styleProfile.confirm.cancel'));
    expect(screen.getByTestId('styleProfile.segment.women').props.accessibilityState).toMatchObject({ checked: true });

    await fireEvent.press(screen.getByTestId('styleProfile.segment.men'));
    await waitFor(() => expect(screen.getByTestId('styleProfile.confirm.go')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('styleProfile.confirm.go'));
    await waitFor(() => expect(screen.getByTestId('styleProfile.tags.men')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('styleProfile.segment.men').props.accessibilityState).toMatchObject({ checked: true });
    // Minimal and Classic are in both sets; Bohem is not.
    expect(screen.getByTestId('styleProfile.tag.minimal').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('styleProfile.tag.classic').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByText('2 / 3')).toBeTruthy();
    expect(screen.getByTestId('styleProfile.save').props.accessibilityState).toMatchObject({ disabled: true });

    await fireEvent.press(screen.getByTestId('styleProfile.tag.tailored'));
    await fireEvent.press(screen.getByTestId('styleProfile.save'));
    await waitFor(() => expect(mockStyle.saved).toHaveLength(1), WAIT);
    expect(mockStyle.saved[0]).toMatchObject({ segment: 'men', styleTags: ['minimal', 'classic', 'tailored'], budget: 'mixed', baseVersion: 3 });
    expect(segmentStore.get()).toBe('men');
  });
});

describe('copy per segment', () => {
  it('30 palette: the face-photo copy is neutral (no make-up wording) in both languages', () => {
    expect(i18n.t('palette.emptyBody', { lng: 'en' })).not.toMatch(/make-up/i);
    expect(i18n.t('palette.emptyBody', { lng: 'tr' })).not.toMatch(/makyaj/i);
  });
});
