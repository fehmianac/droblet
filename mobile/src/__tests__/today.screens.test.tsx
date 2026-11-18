import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { weekStartOf } from '@/features/today/dates';
import { resetFixtureDb } from '@/fixtures/db';
import { todayFixtureOptions } from '@/fixtures/today';
import { formatMoney, formatMonthYear, moneyFromMajor, toIsoDate } from '@/lib/format';

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

const WAIT = { timeout: 4000 };
const today = toIsoDate(new Date());

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
  resetFixtureDb();
});

describe('06 Bugün', () => {
  it('shows the logo header, the missing piece and saves the look to the lookbook', async () => {
    await renderRouter('./src/app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByText('Lacivert Blazer')).toBeTruthy(), WAIT);
    expect(screen.getByLabelText('Notifications')).toBeTruthy();
    expect(screen.getByText('MISSING PIECE')).toBeTruthy();
    expect(screen.getByLabelText('Complete the look')).toBeTruthy();
    // The seeded look is already a favourite: the heart removes it, optimistically.
    await fireEvent.press(screen.getByLabelText('Remove from lookbook'));
    await waitFor(() => expect(screen.getByLabelText('Save to lookbook')).toBeTruthy(), WAIT);
  });

  it('shows the no-plan state with one action when nothing is planned', async () => {
    resetFixtureDb({ empty: true });
    await renderRouter('./src/app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByText('Nothing planned for today')).toBeTruthy(), WAIT);
    expect(screen.getByText('Ask the stylist')).toBeTruthy();
  });
});

describe('07 Haftalık plan', () => {
  it('lists the week, asks before spending credits and removes a look from the ⋯ menu', async () => {
    await renderRouter('./src/app', { initialUrl: '/plan/week' });
    await waitFor(() => expect(screen.getByText('Lacivert Blazer')).toBeTruthy(), WAIT);
    expect(screen.getByText('Weekly plan')).toBeTruthy();
    expect(screen.getByText('Plan my week')).toBeTruthy();
    // "Today" = the day badge and the tab of the bottom menu, which stays on this list screen (canvas 07).
    expect(screen.getAllByText('Today').length).toBe(2);

    // 07b: the cost is shown before anything is spent.
    await fireEvent.press(screen.getByText('Try it on me'));
    await waitFor(() => expect(screen.getByText(/credits? will be used/)).toBeTruthy(), WAIT);
    expect(screen.getByText('TRY IT ON ME · WHOLE WEEK')).toBeTruthy();
    await fireEvent.press(screen.getByText('Cancel'));

    // Today is always the last planned row of its week in the fixtures.
    const menus = screen.getAllByLabelText(/^Options for /);
    await fireEvent.press(menus[menus.length - 1] as (typeof menus)[number]);
    await waitFor(() => expect(screen.getByText('Remove')).toBeTruthy(), WAIT);
    expect(screen.getByText('Change')).toBeTruthy();
    await fireEvent.press(screen.getByText('Remove'));
    await waitFor(() => expect(screen.queryByText('Lacivert Blazer')).toBeNull(), WAIT);
    expect(screen.getAllByLabelText(/^Options for /)).toHaveLength(menus.length - 1);
  });

  it('shows the empty state when there is no look and no plan', async () => {
    resetFixtureDb({ empty: true });
    await renderRouter('./src/app', { initialUrl: '/plan/week' });
    await waitFor(() => expect(screen.getByText('Create a look')).toBeTruthy(), WAIT);
  });
});

describe("08 Haftanın edit'i", () => {
  const firstLook = `edit_${weekStartOf(today)}_1`;

  it('hides owned pieces, totals the missing ones and switches the price band', async () => {
    await renderRouter('./src/app', { initialUrl: `/edit/current?look=${firstLook}` });
    await waitFor(() => expect(screen.getByText('Beyaz Gömlek, Net Çizgi')).toBeTruthy(), WAIT);
    expect(screen.getByText('2 pieces are already in your wardrobe · hidden')).toBeTruthy();
    expect(screen.queryByText('Beyaz Poplin Gömlek')).toBeNull();
    expect(screen.getByText('2 missing pieces')).toBeTruthy();
    expect(screen.getByText(formatMoney(moneyFromMajor(16250, 'TRY')))).toBeTruthy();

    await fireEvent.press(screen.getByText('Luxury touch'));
    await waitFor(() => expect(screen.getByText(formatMoney(moneyFromMajor(53400, 'TRY')))).toBeTruthy(), WAIT);
    expect(screen.getByText('Yapılı Deri Çanta')).toBeTruthy();

    await fireEvent.press(screen.getByText('Show'));
    expect(screen.getByText('Beyaz Poplin Gömlek')).toBeTruthy();
    // Showing owned pieces never changes the total.
    expect(screen.getByText(formatMoney(moneyFromMajor(53400, 'TRY')))).toBeTruthy();
  });

  it('adds a piece to the watch list', async () => {
    await renderRouter('./src/app', { initialUrl: `/edit/current?look=${firstLook}` });
    await waitFor(() => expect(screen.getByLabelText('Add to my watch list: Deri Kroko Babet')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByLabelText('Add to my watch list: Deri Kroko Babet'));
    await waitFor(() => expect(screen.getByLabelText('On your watch list: Deri Kroko Babet')).toBeTruthy(), WAIT);
    expect(screen.getByText(/Added to your watch list/)).toBeTruthy();
  });

  it('asks for a body photo instead of showing the try-on image when there is none', async () => {
    todayFixtureOptions.hasBodyPhoto = false;
    await renderRouter('./src/app', { initialUrl: `/edit/current?look=${firstLook}` });
    await waitFor(() => expect(screen.getByText('Complete your profile photo')).toBeTruthy(), WAIT);
    expect(screen.getByText('Add a photo')).toBeTruthy();
    expect(screen.getByText('Beyaz Gömlek, Net Çizgi')).toBeTruthy();
  });
});

describe('09 Takvim', () => {
  it('shows the month, its summary and the day sheet for a planned day', async () => {
    await renderRouter('./src/app', { initialUrl: '/calendar' });
    await waitFor(() => expect(screen.getByText(/days? logged|Nothing logged this month yet/)).toBeTruthy(), WAIT);
    expect(screen.getByText(formatMonthYear(new Date()))).toBeTruthy();

    await fireEvent.press(screen.getByLabelText(/, planned, today$/));
    await waitFor(() => expect(screen.getByText('Planned')).toBeTruthy(), WAIT);
    expect(screen.getByText('Lacivert Blazer')).toBeTruthy();
    expect(screen.getByText('Open look')).toBeTruthy();
  });

  it('offers a stylist suggestion for an empty day and moves between months', async () => {
    resetFixtureDb({ empty: true });
    await renderRouter('./src/app', { initialUrl: '/calendar' });
    await waitFor(() => expect(screen.getByText('Nothing logged this month yet')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByLabelText(/, empty, today$/));
    await waitFor(() => expect(screen.getByText('Suggest for this day')).toBeTruthy(), WAIT);

    await fireEvent.press(screen.getByLabelText('Close'));
    await fireEvent.press(screen.getByLabelText('Next month'));
    const next = new Date();
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    await waitFor(() => expect(screen.getByText(formatMonthYear(next))).toBeTruthy(), WAIT);
  });
});
