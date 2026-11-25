import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Share } from 'react-native';

import { fixtureDb, resetFixtureDb } from '@/fixtures/db';
import { ApiError } from '@/api/errors';
import * as tripFixtures from '@/fixtures/trips';
import { fixtureGetTrip, fixtureListTrips } from '@/fixtures/trips';

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

beforeEach(async () => {
  resetFixtureDb();
  await AsyncStorage.clear();
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
});

describe('18 Bavullar', () => {
  it('shows the new-suitcase form with upcoming and past trips', async () => {
    await renderRouter('./src/app', { initialUrl: '/wardrobe/trips' });
    await waitFor(() => expect(screen.getByText('LONDRA')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText('SUITCASE')).toBeTruthy();
    expect(screen.getByText('Your travel plans')).toBeTruthy();
    expect(screen.getByText('New suitcase')).toBeTruthy();
    expect(screen.getByText('UPCOMING TRIPS')).toBeTruthy();
    expect(screen.getByText('PAST TRIPS')).toBeTruthy();
    expect(screen.getByText('PARIS')).toBeTruthy();
    expect(screen.getByText('Past')).toBeTruthy();
    expect(screen.getByText(/4 days · 6 pieces/)).toBeTruthy();
    // A packed, upcoming suitcase says how much of it is in the bag.
    expect(screen.getByText('3 / 9 packed')).toBeTruthy();
  });

  it('validates the form and offers city suggestions', async () => {
    await renderRouter('./src/app', { initialUrl: '/wardrobe/trips' });
    await waitFor(() => expect(screen.getByText('LONDRA')).toBeTruthy(), { timeout: 3000 });

    await fireEvent.press(screen.getByTestId('trip-submit'));
    expect(screen.getByText('Choose a city from the list.')).toBeTruthy();
    expect(screen.getByText('Pick your departure date.')).toBeTruthy();
    expect(fixtureListTrips()).toHaveLength(2);

    await fireEvent.changeText(screen.getByLabelText('City'), 'ist');
    await waitFor(() => expect(screen.getByLabelText('İstanbul, Türkiye')).toBeTruthy(), { timeout: 3000 });
    await fireEvent.press(screen.getByLabelText('İstanbul, Türkiye'));
    expect(screen.queryByText('Choose a city from the list.')).toBeNull();
  });

  it('offers both Londons as two-line options (board: Londra / London, Ontario)', async () => {
    await renderRouter('./src/app', { initialUrl: '/wardrobe/trips' });
    await waitFor(() => expect(screen.getByLabelText('City')).toBeTruthy(), { timeout: 3000 });
    await fireEvent.changeText(screen.getByLabelText('City'), 'Lond');
    await waitFor(() => expect(screen.getByLabelText('Londra, Birleşik Krallık')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByLabelText('London, Ontario, Kanada')).toBeTruthy();
    expect(screen.getByText('Ontario, Kanada')).toBeTruthy();
    expect(screen.getByText('Cabin bag only')).toBeTruthy();
    expect(screen.getByText('Create suitcase')).toBeTruthy();
  });

  it('opens a suitcase from its row', async () => {
    await renderRouter('./src/app', { initialUrl: '/wardrobe/trips' });
    await waitFor(() => expect(screen.getByText('PARIS')).toBeTruthy(), { timeout: 3000 });
    await fireEvent.press(screen.getByLabelText(/^Paris, /));
    await waitFor(() => expect(screen).toHavePathname('/trip/trip_paris'), { timeout: 3000 });
  });

  it('shows one sentence when there is no suitcase yet, with the form still usable', async () => {
    resetFixtureDb({ empty: true });
    await renderRouter('./src/app', { initialUrl: '/wardrobe/trips' });
    await waitFor(() => expect(screen.getByText('No suitcases yet')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText("Pick the city and dates; we'll prepare the list.")).toBeTruthy();
    expect(screen.getByTestId('empty-illustration-trips', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('trip-submit')).toBeTruthy();
  });
});

describe('Yeni bavul (trip/new, derived from 18)', () => {
  it('shows the form under a modal header and validates it', async () => {
    await renderRouter('./src/app', { initialUrl: '/trip/new' });
    await waitFor(() => expect(screen.getByText('New suitcase')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByLabelText('Close')).toBeTruthy();
    expect(screen.getByLabelText('Departure: Pick a date')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('trip-submit'));
    expect(screen.getByText('Choose a city from the list.')).toBeTruthy();
  });

  it('loads an existing suitcase for editing', async () => {
    await renderRouter('./src/app', { initialUrl: '/trip/new?id=trip_londra' });
    await waitFor(() => expect(screen.getByText('Edit suitcase')).toBeTruthy(), { timeout: 3000 });
    await waitFor(() => expect(screen.getByDisplayValue('Londra')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText('Save')).toBeTruthy();
  });
});

describe('19 Bavul detayı', () => {
  it('shows the city, the three numbers, the list and the missing piece; checking a row updates the packed count', async () => {
    await renderRouter('./src/app', { initialUrl: '/trip/trip_londra' });
    await waitFor(() => expect(screen.getByText('Packing list')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText('LONDRA')).toBeTruthy();
    expect(screen.getByLabelText('9 pieces · 5 looks')).toBeTruthy();
    expect(screen.getByText('PIECES')).toBeTruthy();
    expect(screen.getByText('RAINY DAYS')).toBeTruthy();
    expect(screen.getByText('Days')).toBeTruthy();
    expect(screen.getByText('Missing')).toBeTruthy();
    // The catalog pick is labelled like the stylist's: "Suggested · Store" + "See".
    expect(screen.getByText('Suggested · Store')).toBeTruthy();
    expect(screen.getByTestId('trip-store-see-prod_rain_boots')).toBeTruthy();
    expect(screen.getByText('Get missing')).toBeTruthy();
    expect(screen.getByLabelText('Packing: 3 of 9 pieces ready')).toBeTruthy();
    expect(screen.getByText('3 / 9 packed')).toBeTruthy();

    const row = screen.getByLabelText('Düz jean');
    expect(row).not.toBeChecked();
    await fireEvent.press(row);
    await waitFor(() => expect(screen.getByLabelText('Packing: 4 of 9 pieces ready')).toBeTruthy());
    expect(screen.getByLabelText('Düz jean')).toBeChecked();
    await waitFor(() => expect(fixtureGetTrip('trip_londra').packedCount).toBe(4), { timeout: 3000 });

    await fireEvent.press(screen.getByLabelText('Düz jean'));
    await waitFor(() => expect(screen.getByLabelText('Packing: 3 of 9 pieces ready')).toBeTruthy());
  });

  it('shares the suitcase as a readable packing list', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    await renderRouter('./src/app', { initialUrl: '/trip/trip_londra' });
    await waitFor(() => expect(screen.getByTestId('trip-share')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByLabelText('Share')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('trip-share'));
    expect(share).toHaveBeenCalledTimes(1);
    const { message } = share.mock.calls[0]?.[0] as { message: string };
    expect(message).toMatch(/^Londra suitcase · .* · 5 days/);
    expect(message).toContain('Packing list\n');
    expect(message).toContain('• Lacivert yün blazer (packed)');
    expect(message).toContain('• Düz jean\n');
    expect(message).toContain('Daily looks\n');
    expect(message).toContain('Missing piece\nYağmur botu · 3 gün yağmur var');
    expect(message.endsWith('Prepared with Droblet.')).toBe(true);
    share.mockRestore();
  });

  it('lists every piece with its category, tags the daily looks with the weekday and opens the day sheet', async () => {
    await renderRouter('./src/app', { initialUrl: '/trip/trip_londra' });
    await waitFor(() => expect(screen.getByText('Packing list')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText('See the looks on me')).toBeTruthy();
    expect(screen.getAllByText('Outerwear').length).toBeGreaterThan(0);

    const trip = fixtureGetTrip('trip_londra');
    const first = trip.days[0];
    const weekday = new Intl.DateTimeFormat('en', { weekday: 'short' }).format(new Date(`${first?.date}T12:00:00`));
    // Every planned day is a card: its own try-on button (with the price) and "Save as a look".
    expect(screen.getByTestId(`trip-day-card-${first?.date}`)).toBeTruthy();
    expect(screen.getByTestId(`trip-day-tryon-${first?.date}`)).toBeTruthy();
    expect(screen.getAllByText('See it on me · 1 credit').length).toBeGreaterThan(0);
    expect(screen.getByTestId(`trip-day-save-${first?.date}`)).toBeTruthy();
    // The day's pieces (2 × 2) appear once the wardrobe is loaded; tapping them opens the day sheet.
    await waitFor(() => expect(screen.getByLabelText(`${weekday}: ${first?.look?.name}`)).toBeTruthy(), { timeout: 3000 });
    await fireEvent.press(screen.getByLabelText(`${weekday}: ${first?.look?.name}`));
    // A trip day is the trip's own slot list (not a saved look): it opens the day sheet (try on / save as a look).
    await waitFor(() => expect(screen.getByTestId('trip-day-tryon')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByTestId('trip-day-save-look')).toBeTruthy();
    expect(screen).toHavePathname('/trip/trip_londra');
  });

  it('19b–19c: "Edit" turns the list into add / take out; a wardrobe piece is added by hand and taken out again', async () => {
    await renderRouter('./src/app', { initialUrl: '/trip/trip_londra' });
    await waitFor(() => expect(screen.getByText('Packing list')).toBeTruthy(), { timeout: 3000 });
    const before = fixtureGetTrip('trip_londra');
    const spare = fixtureDb.items.find((i) => !before.items.some((t) => t.itemId === i.id))!;

    await fireEvent.press(screen.getByTestId('trip-list-edit'));
    expect(screen.getByText('Done')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('trip-add-items'));
    await waitFor(() => expect(screen.getByTestId('trip-picker')).toBeTruthy(), { timeout: 3000 });
    // A piece already in the suitcase is tagged and cannot be picked.
    await waitFor(() => expect(screen.getByTestId(`trip-pick-${before.items[0]!.itemId}`)).toBeDisabled(), { timeout: 3000 });
    expect(screen.getByText('Pick a piece')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`trip-pick-${spare.id}`));
    await fireEvent.press(screen.getByText('Add 1 piece'));

    await waitFor(() => expect(screen.getByText('3 / 10 packed')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByTestId(`trip-item-note-${spare.id}`)).toHaveTextContent('Added by you');
    await waitFor(() => expect(fixtureGetTrip('trip_londra').items.find((i) => i.itemId === spare.id)).toMatchObject({ addedByUser: true, plannedWears: 0 }), { timeout: 3000 });

    // Worn by no day: it leaves at once (with an undo).
    await fireEvent.press(screen.getByTestId(`trip-item-remove-${spare.id}`));
    await waitFor(() => expect(screen.getByText('3 / 9 packed')).toBeTruthy(), { timeout: 3000 });
    expect(screen.queryByTestId('trip-item-remove-confirm')).toBeNull();
  });

  it('19b: taking out a piece a day wears asks first, then the piece leaves the list and that day', async () => {
    await renderRouter('./src/app', { initialUrl: '/trip/trip_londra' });
    await waitFor(() => expect(screen.getByText('Packing list')).toBeTruthy(), { timeout: 3000 });
    const before = fixtureGetTrip('trip_londra');
    const worn = before.days[0]!.itemIds![0]!;
    const days = before.days.filter((d) => d.itemIds?.includes(worn)).length;

    await fireEvent.press(screen.getByTestId('trip-list-edit'));
    expect(screen.getByTestId(`trip-item-note-${worn}`)).toHaveTextContent(days === 1 ? "In 1 day's look" : `In ${days} days' looks`);
    await fireEvent.press(screen.getByTestId(`trip-item-remove-${worn}`));
    await waitFor(() => expect(screen.getByTestId('trip-item-remove-confirm')).toBeTruthy(), { timeout: 3000 });
    expect(fixtureGetTrip('trip_londra').items).toHaveLength(9); // nothing happened yet
    await fireEvent.press(screen.getByTestId('trip-item-remove-confirm'));

    await waitFor(() => expect(fixtureGetTrip('trip_londra').items).toHaveLength(8), { timeout: 3000 });
    expect(fixtureGetTrip('trip_londra').days.some((d) => d.itemIds?.includes(worn))).toBe(false);
    expect(screen.queryByTestId(`trip-item-remove-${worn}`)).toBeNull();
  });

  it('19b "Other things": a free-text row is written, ticked and deleted', async () => {
    await renderRouter('./src/app', { initialUrl: '/trip/trip_londra' });
    await waitFor(() => expect(screen.getByText('Other things')).toBeTruthy(), { timeout: 3000 });
    expect(screen.queryByTestId('trip-extra-add')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('trip-extra-input'), '  Passport ');
    await fireEvent.press(screen.getByTestId('trip-extra-add'));

    await waitFor(() => expect(screen.getByLabelText('Passport')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByTestId('trip-extras-count')).toHaveTextContent('0 / 1 packed');
    await fireEvent.press(screen.getByLabelText('Passport'));
    await waitFor(() => expect(screen.getByTestId('trip-extras-count')).toHaveTextContent('1 / 1 packed'), { timeout: 3000 });
    await waitFor(() => expect(fixtureGetTrip('trip_londra').extras).toEqual([expect.objectContaining({ text: 'Passport', packed: true })]), { timeout: 3000 });

    await fireEvent.press(screen.getByTestId('trip-list-edit'));
    await fireEvent.press(screen.getByLabelText('Passport: delete from the list'));
    await waitFor(() => expect(fixtureGetTrip('trip_londra').extras).toEqual([]), { timeout: 3000 });
  });

  it('19d: "Change pieces" opens the day box by box; taking a piece out and saving changes that day only', async () => {
    await renderRouter('./src/app', { initialUrl: '/trip/trip_londra' });
    await waitFor(() => expect(screen.getByText('Packing list')).toBeTruthy(), { timeout: 3000 });
    const before = fixtureGetTrip('trip_londra');
    const day = before.days.find((d) => (d.itemIds?.length ?? 0) > 1)!;
    const out = day.itemIds![0]!;

    await waitFor(() => expect(screen.getByTestId(`trip-day-edit-${day.date}`)).toBeTruthy(), { timeout: 3000 });
    await fireEvent.press(screen.getByTestId(`trip-day-edit-${day.date}`));
    await waitFor(() => expect(screen.getByTestId('trip-day-edit')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText("The day's pieces")).toBeTruthy();
    expect(screen.getByTestId('trip-day-save-edit')).toBeDisabled(); // nothing changed yet
    await waitFor(() => expect(screen.getByTestId(`trip-day-remove-${out}`)).toBeTruthy(), { timeout: 3000 });
    await fireEvent.press(screen.getByTestId(`trip-day-remove-${out}`));
    await fireEvent.press(screen.getByTestId('trip-day-save-edit'));

    await waitFor(() => expect(fixtureGetTrip('trip_londra').days.find((d) => d.date === day.date)?.itemIds).toEqual(day.itemIds!.slice(1)), { timeout: 3000 });
    // The piece stays on the packing list: the user takes it out there.
    expect(fixtureGetTrip('trip_londra').items.some((i) => i.itemId === out)).toBe(true);
    expect(screen.queryByTestId('trip-day-edit')).toBeNull();
  });

  it('switches to the single cabin bag mode with the check box', async () => {
    await renderRouter('./src/app', { initialUrl: '/trip/trip_londra' });
    await waitFor(() => expect(screen.getByTestId('trip-cabin-only')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByLabelText('Single cabin bag')).not.toBeChecked();
    await fireEvent.press(screen.getByTestId('trip-cabin-only'));
    await waitFor(() => expect(screen.getByLabelText('Single cabin bag')).toBeChecked());
    await waitFor(() => expect(fixtureGetTrip('trip_londra').cabinOnly).toBe(true), { timeout: 3000 });
    // The server re-plans the list for a cabin bag.
    await waitFor(() => expect(screen.getByLabelText('6 pieces · 5 looks')).toBeTruthy(), { timeout: 3000 });
  });

  it('opens the suggested product from the missing-piece card', async () => {
    await renderRouter('./src/app', { initialUrl: '/trip/trip_londra' });
    await waitFor(() => expect(screen.getByTestId('trip-store-prod_rain_boots')).toBeTruthy(), { timeout: 3000 });
    await fireEvent.press(screen.getByLabelText('See: Yağmur botu'));
    await waitFor(() => expect(screen).toHavePathname('/shop/product/prod_rain_boots'), { timeout: 3000 });
  });

  it('opens the shop from "Get missing" under the missing pieces', async () => {
    await renderRouter('./src/app', { initialUrl: '/trip/trip_londra' });
    await waitFor(() => expect(screen.getByTestId('trip-complete-missing')).toBeTruthy(), { timeout: 3000 });
    await fireEvent.press(screen.getByTestId('trip-complete-missing'));
    await waitFor(() => expect(screen).toHavePathname('/shop'), { timeout: 3000 });
  });

  it('offers "Delete trip" at the end of the screen', async () => {
    await renderRouter('./src/app', { initialUrl: '/trip/trip_londra' });
    await waitFor(() => expect(screen.getByTestId('trip-delete')).toBeTruthy(), { timeout: 3000 });
    await fireEvent.press(screen.getByTestId('trip-delete'));
    expect(screen.getByText('Delete this suitcase?')).toBeTruthy();
    expect(fixtureListTrips()).toHaveLength(2);
  });

  it('asks before deleting the suitcase', async () => {
    await renderRouter('./src/app', { initialUrl: '/trip/trip_londra' });
    await waitFor(() => expect(screen.getByLabelText('More')).toBeTruthy(), { timeout: 3000 });
    await fireEvent.press(screen.getByLabelText('More'));
    await fireEvent.press(screen.getByLabelText('Delete suitcase'));
    expect(screen.getByText('Delete this suitcase?')).toBeTruthy();
    expect(fixtureListTrips()).toHaveLength(2);
    await fireEvent.press(screen.getByTestId('trip-delete-confirm'));
    await waitFor(() => expect(fixtureListTrips()).toHaveLength(1), { timeout: 3000 });
  });

  it('starts packing a new trip with a ULID request id; premium_required shows the Premium state, not the generic failure', async () => {
    const id = '01M7RXG2H88YETZ4EKG5C4WRVJ';
    tripFixtures.fixtureCreateTrip({ id, cityId: 'city_londra', startDate: '2026-11-25', endDate: '2026-11-29', tripTypes: ['sightseeing'], cabinOnly: false, clientMutationId: id });
    const start = jest.spyOn(tripFixtures, 'fixtureStartPack').mockImplementation(() => {
      throw new ApiError('http', 403, { type: 'premium_required', title: 'premium_required', status: 403, code: 'premium_required' } as never);
    });
    await renderRouter('./src/app', { initialUrl: `/trip/${id}` });
    // The paywall opens over the trip; under it the packing area offers Premium again instead of "We couldn't create it".
    await waitFor(() => expect(screen).toHavePathname('/paywall'), { timeout: 3000 });
    const hidden = { includeHiddenElements: true };
    expect(start).toHaveBeenCalledWith(id, { requestId: id });
    expect(screen.getByTestId('pack-blocked-paywall', hidden)).toBeTruthy();
    expect(screen.getByText('Smart packing is a Premium feature.', hidden)).toBeTruthy();
    expect(screen.queryByText("We couldn't create it right now.", hidden)).toBeNull();
    start.mockRestore();
  });

  it('shows the not-found state (no retry) for an unknown trip, with the way back to the trips', async () => {
    await renderRouter('./src/app', { initialUrl: '/trip/nope' });
    await waitFor(() => expect(screen.getByText('This trip is no longer in your trips.')).toBeTruthy(), { timeout: 3000 });
    expect(screen.queryByText('Try again')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Back to trips'));
    await waitFor(() => expect(screen).toHavePathname('/wardrobe/trips'), { timeout: 3000 });
  });

  it('shows the not-found state when editing an unknown trip', async () => {
    await renderRouter('./src/app', { initialUrl: '/trip/new?id=nope' });
    await waitFor(() => expect(screen.getByText('This trip is no longer in your trips.')).toBeTruthy(), { timeout: 3000 });
    expect(screen.queryByText('Try again')).toBeNull();
  });
});

describe('unknown link', () => {
  it('shows the not-found state with the way back, not the router page', async () => {
    await renderRouter('./src/app', { initialUrl: '/no-such-screen' });
    await waitFor(() => expect(screen.getByTestId('route-not-found')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText('What you were looking for is no longer here.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Go back'));
    await waitFor(() => expect(screen).toHavePathname('/'), { timeout: 3000 });
  });
});
