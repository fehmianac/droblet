import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { onboardingStore } from '@/auth/onboarding';
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

// 04b: the background add can be made to fail (`mockAdd.failures` times) to check the retry toast.
const mockAdd: { failures: number; calls: string[][] } = { failures: 0, calls: [] };
jest.mock('@/api/today', () => {
  const actual = jest.requireActual('@/api/today');
  return {
    ...actual,
    useAddLibraryItems: () => {
      const real = actual.useAddLibraryItems();
      const mutateAsync = async (ids: string[]) => {
        mockAdd.calls.push(ids);
        if (mockAdd.failures > 0) {
          mockAdd.failures -= 1;
          throw new Error('network');
        }
        return real.mutateAsync(ids);
      };
      return { ...real, mutateAsync };
    },
  };
});

const WAIT = { timeout: 5000 };

async function open(url: string) {
  // Through the store, not only AsyncStorage: a previous test may have finished onboarding in memory.
  await onboardingStore.markPending('u1');
  await renderRouter('./src/app', { initialUrl: url });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await i18n.changeLanguage('en');
  mockAdd.failures = 0;
  mockAdd.calls = [];
});

describe('03 Stil profili', () => {
  it('shows the step (no segment cards: 03a asks it), and locks the other tags once three are chosen', async () => {
    await open('/style');
    await waitFor(() => expect(screen.getByText("Let's get to know you")).toBeTruthy(), WAIT);
    expect(screen.getByText('1 / 4')).toBeTruthy();
    expect(screen.queryByText('WHO ARE YOU SHOPPING FOR?')).toBeNull();
    expect(screen.queryByLabelText('Men, Soon')).toBeNull();
    expect(screen.getByTestId('style.tags.women')).toBeTruthy();
    expect(screen.getByText('0 / 3')).toBeTruthy();
    expect(screen.getByTestId('style.continue').props.accessibilityState).toMatchObject({ disabled: true });

    for (const tag of ['minimal', 'quiet_luxury', 'office_chic']) await fireEvent.press(screen.getByTestId(`style.tag.${tag}`));
    await waitFor(() => expect(screen.getAllByText('3 / 3').length).toBeGreaterThan(0), WAIT);
    expect(screen.getByText('3 tags selected; remove one to change.')).toBeTruthy();
    expect(screen.getByTestId('style.tag.vintage').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('style.tag.minimal').props.accessibilityState).toMatchObject({ selected: true, disabled: false });

    await fireEvent.press(screen.getByTestId('style.budget.mixed'));
    await waitFor(() => expect(screen.getByTestId('style.continue').props.accessibilityState).toMatchObject({ disabled: false }), WAIT);
  });

  it('"Skip" (UX turu 2 · 11b) moves on to the consents without tags or budget and saves nothing', async () => {
    await open('/style');
    await waitFor(() => expect(screen.getByText("Let's get to know you")).toBeTruthy(), WAIT);
    expect(screen.getByTestId('style.continue').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId('style.skip'));
    await waitFor(() => expect(screen).toHavePathname('/consents'), WAIT);
  });
});

describe('04 Beden ve fotoğraf', () => {
  it('has the three fields in a row, four photo slots, the privacy note and "Skip"', async () => {
    await open('/body');
    await waitFor(() => expect(screen.getByText("Let's see outfits on you")).toBeTruthy(), WAIT);
    expect(screen.getByText('3 / 4')).toBeTruthy();
    expect(screen.getByTestId('body.height')).toBeTruthy();
    expect(screen.getByTestId('body.weight')).toBeTruthy();
    expect(screen.getAllByLabelText('Add full-length photo')).toHaveLength(3);
    expect(screen.getByLabelText('Add face photo')).toBeTruthy();
    expect(screen.getByText('0 / 3')).toBeTruthy();
    expect(screen.getByText(/visible only to you/)).toBeTruthy();
    // 22c: the "A good full-length photo" strip, one right and two wrong examples, each with its own label.
    expect(screen.getByText('A good full-length photo')).toBeTruthy();
    expect(screen.getByLabelText('Right: full length, in front of a plain wall, in good light')).toBeTruthy();
    expect(screen.getByLabelText('Wrong: too dark')).toBeTruthy();
    expect(screen.getByLabelText('Wrong: upper body only')).toBeTruthy();

    // Size is a field that opens the size sheet.
    await fireEvent.press(screen.getByTestId('body.size'));
    await waitFor(() => expect(screen.getByText('Choose your size')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('body.size.S'));
    await waitFor(() => expect(screen.getByLabelText('Size: S')).toBeTruthy(), WAIT);

    // Height is required before continuing.
    await fireEvent.press(screen.getByTestId('body.continue'));
    await waitFor(() => expect(screen.getByText('Enter a height between 120 and 220 cm.')).toBeTruthy(), WAIT);

    await fireEvent.press(screen.getByTestId('body.skip'));
    await waitFor(() => expect(screen).toHavePathname('/first-items'), WAIT);
  });

  it('04c a body slot and the face tile each offer the camera and the library', async () => {
    await open('/body');
    await waitFor(() => expect(screen.getAllByLabelText('Add full-length photo')).toHaveLength(3), WAIT);
    await fireEvent.press(screen.getAllByLabelText('Add full-length photo')[0]!);
    await waitFor(() => expect(screen.getByTestId('photoSource.body.camera')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('photoSource.body.library')).toBeTruthy();
    expect(screen.getByText('FULL-LENGTH PHOTO · 0 / 3')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('photoSource.close'));
    await waitFor(() => expect(screen.queryByTestId('photoSource.sheet')).toBeNull(), WAIT);

    await fireEvent.press(screen.getByLabelText('Add face photo'));
    await waitFor(() => expect(screen.getByTestId('photoSource.face.camera')).toBeTruthy(), WAIT);
    expect(screen.getByText('Take a selfie')).toBeTruthy();
    expect(screen.getByTestId('photoSource.face.library')).toBeTruthy();
  });
});

describe('04b İlk 5 parça', () => {
  it('counts the selection in the bottom bar and continues without a minimum: 04d Bildirim izni, then Bugün (not the paywall)', async () => {
    await open('/first-items');
    await waitFor(() => expect(screen.getByText('Which of these are in your wardrobe?')).toBeTruthy(), WAIT);
    expect(screen.getByText('4 / 4')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Shoot your own piece')).toBeTruthy(), WAIT);
    expect(screen.getByText('See the full ready-made library')).toBeTruthy();
    // The library sends no pictures (imageUrl: null): every tile draws its category glyph on the piece's colour.
    expect(screen.getAllByTestId('image-slot-garment').length).toBeGreaterThanOrEqual(6);
    expect(screen.queryByTestId('image-slot-figure')).toBeNull();
    expect(screen.getByText('0 / 5 selected')).toBeTruthy();
    expect(screen.getByText('At least 5 pieces recommended')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('firstItems.item.lib_white_shirt'));
    await fireEvent.press(screen.getByTestId('firstItems.item.lib_beige_trench'));
    await waitFor(() => expect(screen.getByText('2 / 5 selected')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('firstItems.item.lib_white_shirt').props.accessibilityState).toMatchObject({ checked: true });

    await fireEvent.press(screen.getByTestId('firstItems.continue'));
    // The permission is still undetermined (jest setup): 04d comes first, "Not now" ends onboarding on Bugün (UX turu 1 · F).
    await waitFor(() => expect(screen).toHavePathname('/push-permission'), WAIT);
    expect(screen.getByText("We'll let you know when your morning outfit is ready")).toBeTruthy();
    expect(await AsyncStorage.getItem('droblet.firstItems.u1')).toBe(JSON.stringify(['lib_white_shirt', 'lib_beige_trench']));
    await fireEvent.press(screen.getByTestId('pushAsk.notNow'));
    await waitFor(() => expect(screen).toHavePathname('/'), WAIT);
    expect(await AsyncStorage.getItem('droblet.onboarding.u1')).toBe('done');
  });

  it('UX turu 2 · 11c: "Continue" does not wait for the save; a failure shows "Try again" on the next screen and retries', async () => {
    mockAdd.failures = 1;
    await open('/first-items');
    await waitFor(() => expect(screen.getByTestId('firstItems.item.lib_white_shirt')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('firstItems.item.lib_white_shirt'));
    await fireEvent.press(screen.getByTestId('firstItems.continue'));

    await waitFor(() => expect(screen).toHavePathname('/push-permission'), WAIT);
    await waitFor(() => expect(screen.getByTestId('toast-message')).toHaveTextContent("Couldn't save your pieces"), WAIT);
    expect(mockAdd.calls).toEqual([['lib_white_shirt']]);

    await fireEvent.press(screen.getByTestId('toast-action'));
    await waitFor(() => expect(mockAdd.calls).toEqual([['lib_white_shirt'], ['lib_white_shirt']]), WAIT);
    expect(screen).toHavePathname('/push-permission');
  });
});
