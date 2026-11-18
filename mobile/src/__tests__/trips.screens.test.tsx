import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Share } from 'react-native';

import { resetFixtureDb } from '@/fixtures/db';
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
    await waitFor(() => expect(screen.getByText('Londra')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText('YOUR TRAVEL PLANS')).toBeTruthy();
    expect(screen.getByText('New suitcase')).toBeTruthy();
    expect(screen.getByText('UPCOMING TRIPS')).toBeTruthy();
    expect(screen.getByText('PAST TRIPS')).toBeTruthy();
    expect(screen.getByText('Paris')).toBeTruthy();
    expect(screen.getByText(/4 days · 6 pieces/)).toBeTruthy();
  });

  it('validates the form and offers city suggestions', async () => {
    await renderRouter('./src/app', { initialUrl: '/wardrobe/trips' });
    await waitFor(() => expect(screen.getByText('Londra')).toBeTruthy(), { timeout: 3000 });

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
    await waitFor(() => expect(screen.getByText('Paris')).toBeTruthy(), { timeout: 3000 });
    await fireEvent.press(screen.getByLabelText(/^Paris, /));
    await waitFor(() => expect(screen).toHavePathname('/trip/trip_paris'), { timeout: 3000 });
  });

  it('shows one sentence when there is no suitcase yet, with the form still usable', async () => {
    resetFixtureDb({ empty: true });
    await renderRouter('./src/app', { initialUrl: '/wardrobe/trips' });
    await waitFor(() => expect(screen.getByText(/No suitcases yet/)).toBeTruthy(), { timeout: 3000 });
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
  it('shows forecast, list and missing piece; checking a row updates the readiness ring', async () => {
    await renderRouter('./src/app', { initialUrl: '/trip/trip_londra' });
    await waitFor(() => expect(screen.getByText('Packing list')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText('Londra')).toBeTruthy();
    expect(screen.getByText('9 pieces · 5 looks')).toBeTruthy();
    expect(screen.getByText('MISSING PIECE')).toBeTruthy();
    expect(screen.getByText('Get missing')).toBeTruthy();
    expect(screen.getByLabelText('Daily weather forecast')).toBeTruthy();
    expect(screen.getByLabelText('Packing: 3 of 9 pieces ready')).toBeTruthy();
    expect(screen.getByText('3/9')).toBeTruthy();

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

  it('lists every piece with its category, tags the daily looks with the weekday and opens a look', async () => {
    await renderRouter('./src/app', { initialUrl: '/trip/trip_londra' });
    await waitFor(() => expect(screen.getByText('Packing list')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText('In your size, within your budget')).toBeTruthy();
    expect(screen.getByText('1 missing piece')).toBeTruthy();
    expect(screen.getByText('See the looks on me')).toBeTruthy();
    expect(screen.getAllByText('Outerwear').length).toBeGreaterThan(0);

    const trip = fixtureGetTrip('trip_londra');
    const first = trip.days[0];
    const weekday = new Intl.DateTimeFormat('en', { weekday: 'short' }).format(new Date(`${first?.date}T12:00:00`));
    expect(screen.getAllByText(weekday.toUpperCase()).length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByLabelText(`${weekday}: ${first?.look?.name}`));
    await waitFor(() => expect(screen).toHavePathname(`/look/${first?.look?.id}`), { timeout: 3000 });
  });

  it('switches to the single cabin bag mode with the check box', async () => {
    await renderRouter('./src/app', { initialUrl: '/trip/trip_londra' });
    await waitFor(() => expect(screen.getByTestId('trip-cabin-only')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByLabelText('Single cabin bag')).not.toBeChecked();
    await fireEvent.press(screen.getByTestId('trip-cabin-only'));
    await waitFor(() => expect(screen.getByLabelText('Single cabin bag')).toBeChecked());
    await waitFor(() => expect(fixtureGetTrip('trip_londra').cabinOnly).toBe(true), { timeout: 3000 });
    // The server re-plans the list for a cabin bag.
    await waitFor(() => expect(screen.getByText('6 pieces · 5 looks')).toBeTruthy(), { timeout: 3000 });
  });

  it('opens the suggested product from the missing-piece card and the shop from the bottom bar', async () => {
    await renderRouter('./src/app', { initialUrl: '/trip/trip_londra' });
    await waitFor(() => expect(screen.getByText('MISSING PIECE')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByLabelText('Missing piece: Yağmur botu · 3 gün yağmur var')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('trip-complete-missing'));
    await waitFor(() => expect(screen).toHavePathname('/shop'), { timeout: 3000 });
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

  it('shows the error state with retry for an unknown trip', async () => {
    await renderRouter('./src/app', { initialUrl: '/trip/nope' });
    await waitFor(() => expect(screen.getByText('Try again')).toBeTruthy(), { timeout: 3000 });
  });
});
