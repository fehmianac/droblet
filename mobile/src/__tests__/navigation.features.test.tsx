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

const mockEntitlement = {
  tier: 'member',
  credits: { monthlyAllowance: 30, remaining: 12, resetsAt: '2026-12-01T00:00:00.000Z' },
};
jest.mock('@/entitlement/useEntitlement', () => ({
  useEntitlement: () => ({ data: mockEntitlement, isError: false, isPending: false, refetch: jest.fn() }),
}));

const TIMEOUT = { timeout: 4000 };

async function open(url: string) {
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
  await renderRouter('./src/app', { initialUrl: url });
}

describe('feature screens (signed in, fixtures, EN)', () => {
  beforeEach(async () => {
    resetStoreFixtures();
    resetSocialFixtures();
    resetAccountFixtures();
    await AsyncStorage.clear();
    await i18n.changeLanguage('en');
  });

  it('20 Keşfet shows the weekly edit, the sponsored label and the cart badge', async () => {
    await open('/discover');
    await waitFor(() => expect(screen.getByText('Net Ofis Klasikleri')).toBeTruthy(), TIMEOUT);
    await waitFor(() => expect(screen.getByText('SPONSORED')).toBeTruthy(), TIMEOUT);
    expect(screen.getByLabelText('Cart, 3 items')).toBeTruthy();
  });

  it('21 Stil mağazası lists products and opens a product', async () => {
    await open('/shop');
    await waitFor(() => expect(screen.getByText('Beyaz Poplin Gömlek')).toBeTruthy(), TIMEOUT);
    expect(screen.getByText('Outfit builder')).toBeTruthy();
    await fireEvent.press(screen.getByText('Beyaz Poplin Gömlek'));
    await waitFor(() => expect(screen.getByText('Add to cart')).toBeTruthy(), TIMEOUT);
    expect(screen.getByText(/Payment and delivery are completed in the Atölye Nord store/)).toBeTruthy();
  });

  it('22 → 24: adding a product puts it in the cart, grouped by brand', async () => {
    await open('/shop/product/prod_005');
    await waitFor(() => expect(screen.getByText('Add to cart')).toBeTruthy(), TIMEOUT);
    await fireEvent.press(screen.getByText('M'));
    await fireEvent.press(screen.getByText('Add to cart'));
    await waitFor(() => expect(screen.getByText('Pay at Defne & Co')).toBeTruthy(), TIMEOUT);
    // The optimistic line is replaced by the server's cart: 3 seeded lines + the new one.
    await waitFor(() => expect(screen.getByText(/4 items · 4 brands/)).toBeTruthy(), TIMEOUT);
  });

  it('24 Sepet opens the brand checkout in the in-app browser and removes lines', async () => {
    const browser = jest.requireMock('expo-web-browser') as { openBrowserAsync: jest.Mock };
    await open('/cart');
    await waitFor(() => expect(screen.getByText('Pay at Liman')).toBeTruthy(), TIMEOUT);
    await fireEvent.press(screen.getByText('Pay at Liman'));
    await waitFor(() => expect(browser.openBrowserAsync).toHaveBeenCalled(), TIMEOUT);
    expect(String(browser.openBrowserAsync.mock.calls[0]?.[0])).toMatch(/^https:\/\/.*click_id=/);

    for (const name of ['Beyaz Poplin Gömlek', 'Deri Kroko Babet', 'City Medium Siyah Çanta']) {
      await fireEvent.press(screen.getByLabelText(`${name}: remove from cart`));
    }
    await waitFor(() => expect(screen.getByText('Your cart is empty')).toBeTruthy(), TIMEOUT);
  });

  it('25 Arkadaş akışı rates a look optimistically', async () => {
    await open('/friends/feed');
    await waitFor(() => expect(screen.getAllByText('Selin').length).toBeGreaterThan(0), TIMEOUT);
    expect(screen.getByText(/4.7 average · rated by 12 friends/)).toBeTruthy();
    await fireEvent.press(screen.getAllByLabelText('5 stars')[0]!);
    await waitFor(() => expect(screen.getByText(/rated by 13 friends/)).toBeTruthy(), TIMEOUT);
  });

  it('26 Kişi profili shows the hidden state for a private closet', async () => {
    await open('/u/deniz');
    await waitFor(() => expect(screen.getByText('This closet is private')).toBeTruthy(), TIMEOUT);
    expect(screen.queryByText('Explore closet')).toBeNull();
  });

  it('28 Profil shows the credit counter from the entitlement', async () => {
    await open('/profile');
    await waitFor(() => expect(screen.getByText('12 of 30 images left this month')).toBeTruthy(), TIMEOUT);
    expect(screen.getByText('Top up credits')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('1 price drop')).toBeTruthy(), TIMEOUT);
  });

  it('29 Ayarlar switches the app language at once and remembers it', async () => {
    await open('/settings');
    await waitFor(() => expect(screen.getByText('Followers only')).toBeTruthy(), TIMEOUT);
    await fireEvent.press(screen.getByText('Türkçe'));
    await waitFor(() => expect(screen.getByText('Yalnızca takipçiler')).toBeTruthy(), TIMEOUT);
    expect(screen.getByText('BİLDİRİMLER')).toBeTruthy();
    expect(await AsyncStorage.getItem('droblet.language')).toBe('tr');
  });

  it('30 Renk paletim shows the palette, and the empty state without a face photo', async () => {
    await open('/palette');
    await waitFor(() => expect(screen.getByText('Warm Autumn')).toBeTruthy(), TIMEOUT);
    expect(screen.getByText('64% of your wardrobe matches your palette')).toBeTruthy();
  });

  it('30 PaletBos', async () => {
    resetAccountFixtures({ palette: 'none', facePhoto: false });
    await open('/palette');
    await waitFor(() => expect(screen.getByText('Upload a face photo first')).toBeTruthy(), TIMEOUT);
  });
});
