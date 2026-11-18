import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { resetAccountFixtures } from '@/fixtures/account';
import { fixtureDb, resetFixtureDb } from '@/fixtures/db';
import { fixtureJobOptions, resetFixtureJobs } from '@/fixtures/jobs';
import { resetStoreFixtures, storeFixtures } from '@/fixtures/store';
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
// Real randomness for client ids: two cart lines added in the same millisecond need different ids, as on a device.
jest.mock('expo-crypto', () => ({
  getRandomValues: <T extends Uint8Array>(bytes: T): T => jest.requireActual<typeof import('crypto')>('crypto').randomFillSync(bytes),
}));

const WAIT = { timeout: 8000 };
jest.setTimeout(30_000);
const DEFAULT_JOB_MS = fixtureJobOptions.durationMs;

async function open(url: string) {
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
  await renderRouter('./src/app', { initialUrl: url });
}

describe('Keşfet and the style store (20–24b, fixtures, EN)', () => {
  beforeEach(async () => {
    resetFixtureDb();
    resetFixtureJobs();
    resetStoreFixtures();
    resetAccountFixtures();
    fixtureJobOptions.durationMs = DEFAULT_JOB_MS;
    fixtureJobOptions.failNext = null;
    await AsyncStorage.clear();
    await i18n.changeLanguage('en');
  });

  it('20 Keşfet: logo header with search and cart, the five chips, the edit cover and the sponsored tag', async () => {
    await open('/discover');
    await waitFor(() => expect(screen.getByText('Net Ofis Klasikleri')).toBeTruthy(), WAIT);
    expect(screen.getByLabelText('Droblet')).toBeTruthy();
    expect(screen.getByLabelText('Search the store')).toBeTruthy();
    expect(screen.getByLabelText('Cart, 3 items')).toBeTruthy();
    for (const chip of ['Editor', 'Shop', 'Influencer', 'Friends', 'TV outfits']) {
      expect(screen.getByLabelText(chip)).toBeTruthy();
    }
    await waitFor(() => expect(screen.getByText('@ornek_stilist')).toBeTruthy(), WAIT);
    // The tag is data-driven: only the card whose `sponsored` flag is set carries it.
    expect(screen.getAllByText('SPONSORED')).toHaveLength(1);
    expect(screen.getByLabelText('Sponsored content, Marka vitrini, Lüks dokunuş')).toBeTruthy();
  });

  it('20 Keşfet: the Mağaza chip opens the store and the Arkadaşlar chip the friends feed', async () => {
    await open('/discover');
    await waitFor(() => expect(screen.getByLabelText('Shop')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByLabelText('Shop'));
    await waitFor(() => expect(screen.getByLabelText('Search the store')).toBeTruthy(), WAIT);
    expect(screen.getByLabelText('Outfit builder')).toBeTruthy();
  });

  it('21 Stil mağazası: Marka, Renk, Beden and the sort label all open ONE filter sheet with apply and clear', async () => {
    await open('/shop');
    await waitFor(() => expect(screen.getByText('White Poplin Shirt')).toBeTruthy(), WAIT);
    expect(screen.queryByTestId('filter-sheet')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Colour'));
    const sheet = await waitFor(() => screen.getByTestId('filter-sheet'), WAIT);
    // Every group lives in the same sheet.
    for (const heading of ['Filter', 'BRAND', 'COLOUR', 'SIZE', 'SORT BY', 'Clear', 'Show results']) {
      expect(within(sheet).getByText(heading)).toBeTruthy();
    }
    await waitFor(() => expect(within(sheet).getByText('Vakko')).toBeTruthy(), WAIT);

    await fireEvent.press(within(sheet).getByText('Vakko'));
    await fireEvent.press(within(sheet).getByText('Price: high to low'));
    await fireEvent.press(within(sheet).getByText('Show results'));

    await waitFor(() => expect(screen.queryByTestId('filter-sheet')).toBeNull(), WAIT);
    await waitFor(() => expect(screen.queryByText('White Poplin Shirt')).toBeNull(), WAIT);
    expect(screen.getByLabelText('Brand · 1')).toBeTruthy();
    expect(screen.getByLabelText('Sort: Price: high to low')).toBeTruthy();
    expect(screen.getAllByText('VAKKO').length).toBeGreaterThan(0);
    expect(screen.queryByText('MARKS & SPENCER')).toBeNull();

    // The sort label opens the same sheet; "Clear" + apply brings the full catalogue back.
    await fireEvent.press(screen.getByLabelText('Sort: Price: high to low'));
    const again = await waitFor(() => screen.getByTestId('filter-sheet'), WAIT);
    await fireEvent.press(within(again).getByText('Clear'));
    await fireEvent.press(within(again).getByText('Show results'));
    await waitFor(() => expect(screen.getByText('White Poplin Shirt')).toBeTruthy(), WAIT);
    expect(screen.getByLabelText('Brand')).toBeTruthy();
    expect(screen.getByLabelText('Sort: Newest')).toBeTruthy();
  });

  it('21 Stil mağazası: "Parçamı tamamla" asks for a wardrobe piece and filters the grid by it', async () => {
    await open('/shop');
    await waitFor(() => expect(screen.getByLabelText('Complete my piece')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByLabelText('Complete my piece'));
    await waitFor(() => expect(screen.getByText('Which piece shall we complete?')).toBeTruthy(), WAIT);
    const piece = fixtureDb.items[0];
    if (!piece) throw new Error('fixture');
    await waitFor(() => expect(screen.getByLabelText(piece.name)).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByLabelText(piece.name));
    await waitFor(() => expect(screen.getByLabelText('Remove the match filter')).toBeTruthy(), WAIT);
  });

  it('22 Ürün: "Üzerimde" confirms the credit, starts the shared try-on job and shows the image on you', async () => {
    fixtureJobOptions.durationMs = 900;
    fixtureJobOptions.tryOnImageUrl = 'https://example.com/tryon.jpg';
    const before = fixtureDb.entitlement.credits.remaining;
    await open('/shop/product/prod_001');
    await waitFor(() => expect(screen.getByText('Add to cart')).toBeTruthy(), WAIT);
    expect(screen.queryByText('ON YOU')).toBeNull();

    await fireEvent.press(screen.getByLabelText('On me'));
    // The same credit confirmation as every other AI image.
    await waitFor(() => expect(screen.getByText('1 credit will be used')).toBeTruthy(), WAIT);
    await waitFor(() => expect(screen.getByTestId('credit-confirm')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('credit-confirm'));

    // The shared AI wait: rotating progress sentences, no spinner.
    await waitFor(() => expect(screen.getByText('Getting the pieces ready…')).toBeTruthy(), WAIT);
    await waitFor(() => expect(screen.getByText('ON YOU')).toBeTruthy(), WAIT);
    expect(screen.getByLabelText('White Poplin Shirt, on you')).toBeTruthy();
    expect(fixtureDb.entitlement.credits.remaining).toBe(before - 1);

    // Back to the product photo and again to "Üzerimde": the same image, no second confirmation or credit.
    await fireEvent.press(screen.getByLabelText('Product'));
    await waitFor(() => expect(screen.queryByText('ON YOU')).toBeNull(), WAIT);
    await fireEvent.press(screen.getByLabelText('On me'));
    await waitFor(() => expect(screen.getByText('ON YOU')).toBeTruthy(), WAIT);
    expect(screen.queryByText('1 credit will be used')).toBeNull();
    expect(fixtureDb.entitlement.credits.remaining).toBe(before - 1);
  });

  it('22 Ürün: a product without a picture shows its garment placeholder, and a try-on without an image the piece — never "ON YOU"', async () => {
    fixtureJobOptions.durationMs = 300;
    await open('/shop/product/prod_001');
    await waitFor(() => expect(screen.getByText('Add to cart')).toBeTruthy(), WAIT);
    // No product photo in the fixtures: the category glyph on the product's colour, labelled with its name.
    expect(screen.getByLabelText('White Poplin Shirt')).toBeTruthy();
    expect(screen.getAllByTestId('image-slot-garment')).toHaveLength(1);

    await fireEvent.press(screen.getByLabelText('On me'));
    await waitFor(() => expect(screen.getByTestId('credit-confirm')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('credit-confirm'));
    // The job finishes without an image: the piece collage stands in, without the AI marker.
    await waitFor(() => expect(screen.getByText('Piece collage')).toBeTruthy(), WAIT);
    expect(screen.getByLabelText('White Poplin Shirt, piece collage')).toBeTruthy();
    expect(screen.getByTestId('image-slot-collage')).toBeTruthy();
    expect(screen.queryByText('ON YOU')).toBeNull();
  });

  it('21 / 24: product tiles and cart lines without a picture draw the garment placeholder', async () => {
    await open('/shop');
    await waitFor(() => expect(screen.getAllByTestId('image-slot-garment').length).toBeGreaterThan(0), WAIT);
    expect(screen.queryByTestId('image-slot-figure')).toBeNull();
    await open('/cart');
    await waitFor(() => expect(screen.getAllByTestId('image-slot-garment')).toHaveLength(3), WAIT);
  });

  it('22 Ürün: a failed try-on says the credit was refunded and offers "Tekrar dene"', async () => {
    fixtureJobOptions.durationMs = 300;
    fixtureJobOptions.tryOnImageUrl = 'https://example.com/tryon.jpg';
    fixtureJobOptions.failNext = { code: 'generation_failed', creditRefunded: true };
    const before = fixtureDb.entitlement.credits.remaining;
    await open('/shop/product/prod_001');
    await waitFor(() => expect(screen.getByText('Add to cart')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByLabelText('On me'));
    await waitFor(() => expect(screen.getByTestId('credit-confirm')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('credit-confirm'));

    await waitFor(() => expect(screen.getByText("We couldn't create it right now. Your credit was refunded.")).toBeTruthy(), WAIT);
    expect(fixtureDb.entitlement.credits.remaining).toBe(before);

    // "Tekrar dene" starts a fresh job straight away (the credit came back).
    await fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => expect(screen.getByText('ON YOU')).toBeTruthy(), WAIT);
  });

  it('22 Ürün: without credits the confirmation offers a top-up instead of starting', async () => {
    fixtureDb.entitlement.credits.remaining = 0;
    await open('/shop/product/prod_001');
    await waitFor(() => expect(screen.getByText('Add to cart')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByLabelText('On me'));
    await waitFor(() => expect(screen.getByText('Add credits')).toBeTruthy(), WAIT);
    expect(screen.queryByTestId('credit-confirm')).toBeNull();
  });

  it('22 Ürün: size picker, wardrobe match, the watchlist entry (separate from the heart) and the bar', async () => {
    await open('/shop/product/prod_001');
    await waitFor(() => expect(screen.getByText('Add to cart')).toBeTruthy(), WAIT);
    expect(screen.getByText('MARKS & SPENCER')).toBeTruthy();
    // No body profile in this test session: nothing is preselected, so the bar asks for a size first.
    await fireEvent.press(screen.getByText('Add to wardrobe'));
    await waitFor(() => expect(screen.getByText('Pick a size to continue.')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByLabelText('S'));
    expect(screen.getByLabelText('S').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.queryByText('Pick a size to continue.')).toBeNull();
    await waitFor(() => expect(screen.getByText('Show')).toBeTruthy(), WAIT);
    expect(screen.getByText('Add to wardrobe')).toBeTruthy();
    expect(screen.getByLabelText('Cart, 3 items')).toBeTruthy();

    expect(storeFixtures.watchlist().items.some((i) => i.productId === 'prod_001')).toBe(false);
    await fireEvent.press(screen.getByText('Add to my watchlist'));
    await waitFor(() => expect(screen.getByText('On your watchlist')).toBeTruthy(), WAIT);
    await waitFor(() => expect(storeFixtures.watchlist().items.some((i) => i.productId === 'prod_001')).toBe(true), WAIT);
    // The heart is a different list.
    expect(storeFixtures.favorites().productIds).toEqual([]);
    expect(screen.getByLabelText('Add to favourites')).toBeTruthy();
  });

  it('23 Kombin oluşturucu: preview tag, the five slots, suggestions for the selected slot and the two actions', async () => {
    await open('/shop/builder?productId=prod_001');
    await waitFor(() => expect(screen.getByText('White Poplin Shirt')).toBeTruthy(), WAIT);
    expect(screen.getByText('PREVIEW')).toBeTruthy();
    expect(screen.getByText('Marks & Spencer · ₺3,000')).toBeTruthy();
    for (const slot of ['Bottom · empty', 'Outerwear · empty', 'Shoes · empty', 'Bag · empty']) {
      expect(screen.getByText(slot)).toBeTruthy();
    }
    // The seeded shirt fills "Top"; the next empty slot is selected and gets the suggestions.
    expect(screen.getByText('Suggestions for Bottom')).toBeTruthy();
    expect(screen.getByText('Buy 1 product')).toBeTruthy();
    expect(screen.getByLabelText('Save to lookbook').props.accessibilityState).toMatchObject({ disabled: true });

    await fireEvent.press(screen.getByText('Bag · empty'));
    await waitFor(() => expect(screen.getByText('Suggestions for Bag')).toBeTruthy(), WAIT);
    await waitFor(() => expect(screen.getByLabelText('Beymen Club, City Medium Black Bag, ₺12,950')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByLabelText('Beymen Club, City Medium Black Bag, ₺12,950'));
    await waitFor(() => expect(screen.getByText('Buy 2 products')).toBeTruthy(), WAIT);
    expect(screen.getByLabelText('Save to lookbook').props.accessibilityState).toMatchObject({ disabled: false });

    await fireEvent.press(screen.getByText('Buy 2 products'));
    await waitFor(() => expect(screen.getByText('5 items · 2 brands')).toBeTruthy(), WAIT);
  });

  it('24 Sepet: rows grouped by brand with a pay button each, totals stacked in the bar, watchlist link', async () => {
    await open('/cart');
    await waitFor(() => expect(screen.getByText('Pay at Marks & Spencer')).toBeTruthy(), WAIT);
    expect(screen.getByText('Pay at Beymen Club')).toBeTruthy();
    expect(screen.getByText("Adding to the cart doesn't buy anything; you pay in each brand's own store.")).toBeTruthy();
    expect(screen.getByText('Size: One size')).toBeTruthy();
    expect(screen.getByText('3 items · 2 brands')).toBeTruthy();
    expect(screen.getByText('₺19,250')).toBeTruthy();
    expect(screen.getByLabelText('My watchlist')).toBeTruthy();
  });

  it('24 Sepet · boş: the empty state as drawn, without the watchlist button, leads to the store', async () => {
    for (const line of storeFixtures.cart().groups.flatMap((g) => g.lines)) storeFixtures.removeCartLine(line.lineId);
    await open('/cart');
    await waitFor(() => expect(screen.getByText('Your cart is empty')).toBeTruthy(), WAIT);
    expect(screen.getByText('Pieces that complete your looks are gathered here by brand.')).toBeTruthy();
    expect(screen.queryByLabelText('My watchlist')).toBeNull();
    await fireEvent.press(screen.getByText('Explore products'));
    await waitFor(() => expect(screen.getByLabelText('Search the store')).toBeTruthy(), WAIT);
  });

  it('24b İzleme listem: price-drop badge with "Sepete ekle", "Ürünü gör" otherwise, and the alert switch', async () => {
    await open('/watchlist');
    await waitFor(() => expect(screen.getByText('Price dropped 20%')).toBeTruthy(), WAIT);
    expect(screen.getByText("WE'LL TELL YOU WHEN THE PRICE DROPS")).toBeTruthy();
    expect(screen.getByText('From the “Beyaz Gömlek, Net Çizgi” look')).toBeTruthy();
    expect(screen.getByText('From the edit of the week')).toBeTruthy();
    // Dropped price → "Sepete ekle"; from the edit → "Ürünü gör"; added by hand → no action row.
    expect(screen.getAllByText('Add to cart')).toHaveLength(1);
    expect(screen.getAllByText('View product')).toHaveLength(1);
    expect(screen.getByLabelText('Previous price ₺4,125')).toBeTruthy();
    expect(screen.getAllByLabelText('Price alert on')).toHaveLength(2);

    await fireEvent.press(screen.getByLabelText('Price alert off'));
    await waitFor(() => expect(screen.getAllByLabelText('Price alert on')).toHaveLength(3), WAIT);
    await waitFor(() => expect(storeFixtures.watchlist().items.every((i) => i.alertEnabled)).toBe(true), WAIT);
  });
});
