import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

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

describe('copy per segment · 12b ready-made library', () => {
  it('men: the men search examples and the men set (garment placeholders, no pictures yet)', async () => {
    segmentStore.set('men');
    await openSignedIn('/item/library');
    await waitFor(() => expect(screen.getByPlaceholderText('Search: chinos, blazer, loafers')).toBeTruthy(), WAIT);
    await waitFor(() => expect(screen.getByText('Chino pantolon')).toBeTruthy(), WAIT);
    expect(screen.getByText('Kravat')).toBeTruthy();
    expect(screen.queryByText('Kroko babet')).toBeNull();
    expect(screen.getAllByTestId('image-slot-garment').length).toBeGreaterThan(0);
  });

  it('women: the copy and the set are unchanged', async () => {
    await openSignedIn('/item/library');
    await waitFor(() => expect(screen.getByPlaceholderText('Search: trench coat, jeans, flats')).toBeTruthy(), WAIT);
    await waitFor(() => expect(screen.getByText('Kroko babet')).toBeTruthy(), WAIT);
  });
});
