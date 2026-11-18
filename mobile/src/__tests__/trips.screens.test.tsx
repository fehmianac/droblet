import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

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
});

describe('19 Bavul detayı', () => {
  it('shows forecast, list and missing piece; checking a row updates the readiness ring', async () => {
    await renderRouter('./src/app', { initialUrl: '/trip/trip_londra' });
    await waitFor(() => expect(screen.getByText('Packing list')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText('Londra')).toBeTruthy();
    expect(screen.getByText('9 pieces · 5 looks')).toBeTruthy();
    expect(screen.getByText('MISSING PIECE')).toBeTruthy();
    expect(screen.getByText('Complete the missing pieces')).toBeTruthy();
    expect(screen.getByLabelText('Daily weather forecast')).toBeTruthy();
    expect(screen.getByLabelText('Packing: 3 of 9 pieces ready')).toBeTruthy();
    expect(screen.getByText('3 / 9')).toBeTruthy();

    const row = screen.getByLabelText('Düz jean');
    expect(row).not.toBeChecked();
    await fireEvent.press(row);
    await waitFor(() => expect(screen.getByLabelText('Packing: 4 of 9 pieces ready')).toBeTruthy());
    expect(screen.getByLabelText('Düz jean')).toBeChecked();
    await waitFor(() => expect(fixtureGetTrip('trip_londra').packedCount).toBe(4), { timeout: 3000 });

    await fireEvent.press(screen.getByLabelText('Düz jean'));
    await waitFor(() => expect(screen.getByLabelText('Packing: 3 of 9 pieces ready')).toBeTruthy());
  });

  it('shows the error state with retry for an unknown trip', async () => {
    await renderRouter('./src/app', { initialUrl: '/trip/nope' });
    await waitFor(() => expect(screen.getByText('Try again')).toBeTruthy(), { timeout: 3000 });
  });
});
