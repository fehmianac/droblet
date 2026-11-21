import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { requirementsFlow } from '@/features/requirements/store';
import { addDays, monthOf, weekDates, weekStartOf } from '@/features/today/dates';
import { accountFixtures, resetAccountFixtures } from '@/fixtures/account';
import { fixtureDb, resetFixtureDb } from '@/fixtures/db';
import { todayFixtureOptions } from '@/fixtures/today';
import { longDay } from '@/features/stylist/suggestionActions';
import { formatDate, formatIsoDateRange, formatMoney, formatMonthYear, moneyFromMajor, parseLocalDate, toIsoDate, weekdayShort } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';

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
    expect(screen.getByLabelText(/^Notifications/)).toBeTruthy();
    // One line above the name: "BUGÜNÜN KOMBİNİ · OFİS" (no separate badge).
    expect(screen.getByText("TODAY'S OUTFIT · OFFICE")).toBeTruthy();
    // No generated image yet: the invitation tile on the left (as 14b), the pieces on the right — never the "ON YOU"
    // tag on a placeholder, never a piece collage with a call to action over it.
    expect(screen.queryByText('ON YOU')).toBeNull();
    expect(screen.queryByText('Piece collage')).toBeNull();
    expect(screen.queryByTestId('image-slot-collage')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('today-look-invite-footer')).toHaveTextContent('Try it on me · 1 credit'), WAIT);
    expect(screen.getByText('How would this look sit on you?')).toBeTruthy();
    // The piece column marks the missing piece.
    expect(screen.getByTestId('today-look-pieces')).toBeTruthy();
    expect(screen.getAllByLabelText('Missing piece').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Complete the look')).toBeTruthy();
    // The edit strip: the day and the look name are a tag on the image.
    const monday = weekStartOf(today);
    expect(screen.getByText(toDisplayUpper(`${weekdayShort(parseLocalDate(monday))} · Beyaz Gömlek, Net Çizgi`, "en"))).toBeTruthy();
    expect(screen.getByLabelText('Open the edit of the week')).toBeTruthy();
    // The seeded look is already a favourite: the heart removes it, optimistically.
    await fireEvent.press(screen.getByLabelText('Remove from lookbook'));
    await waitFor(() => expect(screen.getByLabelText('Save to lookbook')).toBeTruthy(), WAIT);
  });

  it('shows the no-plan state with one action when nothing is planned', async () => {
    resetFixtureDb({ empty: true });
    await renderRouter('./src/app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByText('Nothing planned for today')).toBeTruthy(), WAIT);
    // Canvas 06 · plan yok: a saved look (no AI) beside the stylist.
    expect(screen.getByText('Pick a look')).toBeTruthy();
    expect(screen.getByText('Ask the stylist')).toBeTruthy();
    // 06 · plan yok: the greeting stands alone, without the occasion line.
    expect(screen.getByText(/^Good (morning|afternoon|evening) Damla\.$/)).toBeTruthy();
    // Without saved looks the sheet says so and keeps the stylist.
    await fireEvent.press(screen.getByTestId('today-plan-pick'));
    await waitFor(() => expect(screen.getByTestId('planPick.empty')).toBeTruthy(), WAIT);
    expect(screen.getByText('You have no saved looks yet.')).toBeTruthy();
    expect(screen.getByTestId('planPick.suggest')).toBeTruthy();
  });

  it('"Pick a look" plans a saved look for today without AI or membership, with the calendar toast', async () => {
    fixtureDb.planDays = fixtureDb.planDays.filter((p) => p.date !== today);
    fixtureDb.entitlement.tier = 'free';
    await renderRouter('./src/app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('today-plan-pick')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('today-plan-pick'));
    await waitFor(() => expect(screen.getByText('Pick a look for this day')).toBeTruthy(), WAIT);
    const look = fixtureDb.looks[0] as (typeof fixtureDb.looks)[number];
    await waitFor(() => expect(screen.getByTestId(`planPick.look.${look.id}`)).toBeTruthy(), WAIT);
    // "Tümü" + the occasions the looks have; the stylist is the only AI path and carries the membership badge.
    expect(screen.getByLabelText('All').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByLabelText('Ask the stylist, Membership')).toBeTruthy();
    expect(screen.getByText(`All my looks (${fixtureDb.looks.length})`)).toBeTruthy();
    expect(screen.getByText('Tap a look to add it to this day.')).toBeTruthy();

    await fireEvent.press(screen.getByTestId(`planPick.look.${look.id}`));
    await waitFor(() => expect(screen.getByTestId('toast-plan-look')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('toast-message').props.children).toBe(`Added to ${longDay(today)}`);
    expect(screen.getByTestId('toast-action').props.accessibilityLabel).toBe('View');
    await waitFor(() => expect(fixtureDb.planDays.find((p) => p.date === today)?.lookId).toBe(look.id), WAIT);
    expect(screen.queryByText('Pick a look for this day')).toBeNull();
  });
});

describe('07 Haftalık plan', () => {
  it('lists the week, asks before spending credits and removes a look from the ⋯ menu', async () => {
    await renderRouter('./src/app', { initialUrl: '/plan/week' });
    await waitFor(() => expect(screen.getByText('Lacivert Blazer')).toBeTruthy(), WAIT);
    expect(screen.getByText('Weekly plan')).toBeTruthy();
    expect(screen.getByText('Plan my week')).toBeTruthy();
    // The rows are this Monday → Sunday week, and the line above the title says exactly that.
    const week = weekDates(today);
    expect(screen.getByText(`THIS WEEK · ${formatIsoDateRange(week[0] as string, week[6] as string).toUpperCase()}`)).toBeTruthy();
    expect(screen.queryByText('THE NEXT 7 DAYS')).toBeNull();
    // The week's occasions are chips; the leading one is the filled one.
    expect(screen.getByLabelText(/^Office ×\d$/).props.accessibilityState).toMatchObject({ selected: true });
    // The bottom menu stays on this list screen (canvas 07).
    expect(screen.getAllByText('Today').length).toBe(1);

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

  it('"Plan" on an empty day and "Change" in the ⋯ menu open 07c; the stylist stays its way out', async () => {
    fixtureDb.planDays = fixtureDb.planDays.filter((p) => p.date !== today);
    await renderRouter('./src/app', { initialUrl: '/plan/week' });
    await waitFor(() => expect(screen.getAllByLabelText(/^Pick a look for /).length).toBeGreaterThan(0), WAIT);
    expect(screen.getAllByText('Plan').length).toBeGreaterThan(0);
    expect(screen.queryByText('Suggest')).toBeNull();
    const dayLabel = formatDate(parseLocalDate(today), { weekday: 'long', day: 'numeric', month: 'long' });
    await fireEvent.press(screen.getByLabelText(`Pick a look for ${dayLabel}`));
    await waitFor(() => expect(screen.getByText('Pick a look for this day')).toBeTruthy(), WAIT);
    const look = fixtureDb.looks[1] as (typeof fixtureDb.looks)[number];
    await waitFor(() => expect(screen.getByTestId(`planPick.look.${look.id}`)).toBeTruthy(), WAIT);
    // A member: no badge on the stylist.
    expect(screen.getByLabelText('Ask the stylist')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`planPick.look.${look.id}`));
    await waitFor(() => expect(screen.getByTestId('toast-plan-look')).toBeTruthy(), WAIT);
    await waitFor(() => expect(fixtureDb.planDays.find((p) => p.date === today)?.lookId).toBe(look.id), WAIT);

    // A planned day: "Change" opens the same sheet; "Ask the stylist" leaves for the stylist.
    const menus = screen.getAllByLabelText(/^Options for /);
    await fireEvent.press(menus[0] as (typeof menus)[number]);
    await waitFor(() => expect(screen.getByText('Change')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByText('Change'));
    await waitFor(() => expect(screen.getByText('Pick a look for this day')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('planPick.suggest'));
    await waitFor(() => expect(screen).toHavePathname('/stylist'), WAIT);
  });

  it('shows the empty state when there is no look and no plan', async () => {
    resetFixtureDb({ empty: true });
    await renderRouter('./src/app', { initialUrl: '/plan/week' });
    await waitFor(() => expect(screen.getByText('Create a look')).toBeTruthy(), WAIT);
  });

  it('names another week by its dates only', async () => {
    const nextWeek = weekDates(addDays(today, 7));
    await renderRouter('./src/app', { initialUrl: `/plan/week?day=${nextWeek[2]}` });
    await waitFor(
      () => expect(screen.getByText(formatIsoDateRange(nextWeek[0] as string, nextWeek[6] as string).toUpperCase())).toBeTruthy(),
      WAIT,
    );
    expect(screen.queryByText(/^THIS WEEK/)).toBeNull();
  });
});

describe('06 Bugün — the "on you" area without a generated image', () => {
  it('asks for a full-length photo when there is none', async () => {
    resetAccountFixtures();
    accountFixtures.removePhoto('body', 'photo_body_1');
    await renderRouter('./src/app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByText('Lacivert Blazer')).toBeTruthy(), WAIT);
    await waitFor(() => expect(screen.getByTestId('today-look-invite-footer')).toHaveTextContent('Add your photo first'), WAIT);
    expect(screen.queryByText('ON YOU')).toBeNull();
    // No dead end (canvas 11): the requirements sheet with the two photo paths.
    await fireEvent.press(screen.getByTestId('today-look-invite'));
    await waitFor(() => expect(screen.getByTestId('requirements.sheet')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('requirements.path.body')).toBeTruthy();
    expect(screen.getByTestId('requirements.path.face')).toBeTruthy();
    requirementsFlow.reset();
    resetAccountFixtures();
  });

  it('says "Unlocks with membership" without a membership, and the tap opens the steps', async () => {
    resetAccountFixtures();
    fixtureDb.entitlement.tier = 'free';
    await renderRouter('./src/app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByText('Lacivert Blazer')).toBeTruthy(), WAIT);
    await waitFor(() => expect(screen.getByTestId('today-look-invite-footer')).toHaveTextContent('Unlocks with membership'), WAIT);
    expect(screen.queryByText('ON YOU')).toBeNull();
    await fireEvent.press(screen.getByTestId('today-look-invite'));
    await waitFor(() => expect(screen.getByTestId('requirements.sheet')).toBeTruthy(), WAIT);
    requirementsFlow.reset();
  });
});

describe("08 Haftanın edit'i", () => {
  const firstLook = `edit_${weekStartOf(today)}_1`;

  it('hides owned pieces, totals the missing ones and switches the price band', async () => {
    await renderRouter('./src/app', { initialUrl: `/edit/current?look=${firstLook}` });
    await waitFor(() => expect(screen.getByText('Beyaz Gömlek, Net Çizgi')).toBeTruthy(), WAIT);
    expect(screen.getByText('2 pieces are already in your wardrobe · hidden')).toBeTruthy();
    // The actions sit on the image; there is no "Sponsored" label on an editorial edit.
    expect(screen.getByLabelText('Go back')).toBeTruthy();
    expect(screen.getByLabelText('Share')).toBeTruthy();
    expect(screen.getByLabelText('Save to lookbook')).toBeTruthy();
    // No look has a generated image: each page is the 06 / 14b card (invitation left, pieces right), without the AI
    // marker and without a collage under a call to action.
    expect(screen.queryByText('ON YOU')).toBeNull();
    expect(screen.queryByText('Piece collage')).toBeNull();
    expect(screen.getAllByTestId('edit-hero-invite').length).toBe(7);
    expect(screen.getAllByTestId('edit-hero-pieces', { includeHiddenElements: true }).length).toBe(7);
    await waitFor(() => expect(screen.getAllByText('Try it on me · 1 credit').length).toBe(7), WAIT);
    expect(screen.queryByText('SPONSORED')).toBeNull();
    expect(screen.queryByText('Beyaz Poplin Gömlek')).toBeNull();
    expect(screen.getByText('2 missing pieces')).toBeTruthy();
    expect(screen.getByText(formatMoney(moneyFromMajor(16250, 'TRY')))).toBeTruthy();

    await fireEvent.press(screen.getByText('Luxury touch'));
    await waitFor(() => expect(screen.getByText(formatMoney(moneyFromMajor(53400, 'TRY')))).toBeTruthy(), WAIT);
    expect(screen.getByText('Yapılı Deri Çanta')).toBeTruthy();

    await fireEvent.press(screen.getByText('Show'));
    expect(screen.getByText('Beyaz Poplin Gömlek')).toBeTruthy();
    expect(screen.getByText('2 pieces are already in your wardrobe')).toBeTruthy();
    expect(screen.getByText('Hide')).toBeTruthy();
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
    // 08 · fotoğraf yok: a plain header with back only, no image, no style note.
    expect(screen.getByLabelText('Go back')).toBeTruthy();
    expect(screen.queryByLabelText('Share')).toBeNull();
    expect(screen.queryByText('ON YOU')).toBeNull();
    expect(screen.queryByText(/Beyaz poplin gömleği/)).toBeNull();
    expect(screen.getByText('2 missing pieces')).toBeTruthy();
  });

  it("shows the Keşfet cover's empty state (not an error) for an edit that does not exist", async () => {
    await renderRouter('./src/app', { initialUrl: '/edit/weekly_nope' });
    await waitFor(() => expect(screen.getByText("This week's edit is being prepared.")).toBeTruthy(), WAIT);
    expect(screen.queryByText('Try again')).toBeNull();
    expect(screen.getByLabelText('Go back')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Browse the store'));
    await waitFor(() => expect(screen).toHavePathname('/shop'), WAIT);
  });

  it('marks a sponsored edit', async () => {
    todayFixtureOptions.sponsoredBy = 'Marks & Spencer';
    await renderRouter('./src/app', { initialUrl: `/edit/current?look=${firstLook}` });
    await waitFor(() => expect(screen.getByText('SPONSORED')).toBeTruthy(), WAIT);
    expect(screen.getByText('Made in partnership with Marks & Spencer.')).toBeTruthy();
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
    expect(screen.getByText('Change')).toBeTruthy();
    // "Değiştir" opens 07c for that day (a saved look, no AI).
    await fireEvent.press(screen.getByTestId('calendar-change'));
    await waitFor(() => expect(screen.getByText('Pick a look for this day')).toBeTruthy(), WAIT);
    expect(screen.getByTestId(`planPick.look.${fixtureDb.looks[0]?.id}`)).toBeTruthy();
  });

  it('opens the month report from "Rapor"', async () => {
    await renderRouter('./src/app', { initialUrl: '/calendar' });
    await waitFor(() => expect(screen.getByText('Report')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByLabelText(`Open the report for ${formatMonthYear(new Date())}`));
    await waitFor(() => expect(screen.getByText('MONTHLY REPORT')).toBeTruthy(), WAIT);
  });

  it('offers "Plan" and a stylist suggestion for an empty day and moves between months', async () => {
    resetFixtureDb({ empty: true });
    await renderRouter('./src/app', { initialUrl: '/calendar' });
    await waitFor(() => expect(screen.getByText('Nothing logged this month yet')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByLabelText(/, empty, today$/));
    await waitFor(() => expect(screen.getByTestId('calendar-plan')).toBeTruthy(), WAIT);
    expect(screen.getByText('No look for this day. Pick one of your saved looks, or let the stylist suggest one.')).toBeTruthy();
    expect(screen.getByTestId('calendar-suggest')).toHaveTextContent('Ask the stylist');
    await fireEvent.press(screen.getByTestId('calendar-plan'));
    await waitFor(() => expect(screen.getByTestId('planPick.empty')).toBeTruthy(), WAIT);

    await fireEvent.press(screen.getByLabelText('Close'));
    await fireEvent.press(screen.getByLabelText('Next month'));
    const next = new Date();
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    await waitFor(() => expect(screen.getByText(formatMonthYear(next))).toBeTruthy(), WAIT);
  });
});

describe('09 › Rapor', () => {
  // The seeded wear logs reach 16 days back, so the previous month always has some when this one is young.
  const previousMonth = monthOf(addDays(`${monthOf(today)}-01`, -1));
  const month = Number(today.slice(8)) > 16 ? monthOf(today) : previousMonth;

  it('reads the month back from the wear logs', async () => {
    await renderRouter('./src/app', { initialUrl: `/plan/report?month=${month}` });
    await waitFor(() => expect(screen.getByText('Most worn')).toBeTruthy(), WAIT);
    expect(screen.getByText('MONTHLY REPORT')).toBeTruthy();
    expect(screen.getByText(formatMonthYear(parseLocalDate(`${month}-01`)))).toBeTruthy();
    expect(screen.getByText(/days? logged$/)).toBeTruthy();
    expect(screen.getByText(/of the month's \d+ days are logged\.$/)).toBeTruthy();
    expect(screen.getByText('Occasions')).toBeTruthy();
    expect(screen.getByText('Not worn this month')).toBeTruthy();
    expect(screen.getAllByText(/^\d+ times?$/).length).toBeGreaterThan(0);
  });

  it('shows one sentence and one action for a month without records', async () => {
    resetFixtureDb({ empty: true });
    await renderRouter('./src/app', { initialUrl: `/plan/report?month=${month}` });
    await waitFor(() => expect(screen.getByText('Back to the calendar')).toBeTruthy(), WAIT);
    expect(screen.getByText(/^Nothing is logged for this month\./)).toBeTruthy();
  });
});
