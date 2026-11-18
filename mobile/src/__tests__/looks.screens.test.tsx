import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { fixtureDb, resetFixtureDb } from '@/fixtures/db';

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

describe('14 Looklar', () => {
  it('lists the lookbook with its count and filters favourites', async () => {
    await renderRouter('./src/app', { initialUrl: '/wardrobe/looks' });
    await waitFor(() => expect(screen.getByText('Lacivert Blazer')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText('4 looks')).toBeTruthy();
    expect(screen.getByText('LOOKBOOK')).toBeTruthy();
    expect(screen.getByText('Siyah Düz Elbise')).toBeTruthy();
    expect(screen.getByLabelText('Office, Lacivert Blazer, average rating 4.6')).toBeTruthy();

    await fireEvent.press(screen.getByText('Favourites'));
    expect(screen.getByText('Lacivert Blazer')).toBeTruthy();
    expect(screen.queryByText('Siyah Düz Elbise')).toBeNull();

    await fireEvent.press(screen.getByText('Travel'));
    expect(screen.getByText('No looks match this filter.')).toBeTruthy();
  });

  it('toggles a favourite through the queue (optimistic)', async () => {
    await renderRouter('./src/app', { initialUrl: '/wardrobe/looks' });
    await waitFor(() => expect(screen.getByText('Tüvit & Jean')).toBeTruthy(), { timeout: 3000 });
    await fireEvent.press(screen.getByLabelText('Tüvit & Jean: add to favourites'));
    await waitFor(() => expect(screen.getByLabelText('Tüvit & Jean: remove from favourites')).toBeTruthy());
    await waitFor(() => expect(fixtureDb.looks.find((l) => l.id === 'look_tuvit_jean')?.isFavorite).toBe(true), { timeout: 3000 });
  });

  it('shows the empty state with one action', async () => {
    resetFixtureDb({ empty: true });
    await renderRouter('./src/app', { initialUrl: '/wardrobe/looks' });
    await waitFor(() => expect(screen.getByText(/Your lookbook is empty/)).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText('0 looks')).toBeTruthy();
  });
});

describe('15 Look oluştur', () => {
  it('keeps Save disabled until 2 pieces are chosen in the slot sheet, then saves', async () => {
    await renderRouter('./src/app', { initialUrl: '/look/new' });
    await waitFor(() => expect(screen.getByText('0 / 5 PIECES SELECTED')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByTestId('look-save')).toBeDisabled();
    expect(screen.getByText('Save unlocks once at least 2 pieces are selected.')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Choose Top'));
    await waitFor(() => expect(screen.getByText('Beyaz poplin gömlek')).toBeTruthy(), { timeout: 3000 });
    // Only pieces that fit the slot are offered.
    expect(screen.queryByText('Düz jean')).toBeNull();
    await fireEvent.press(screen.getByText('Beyaz poplin gömlek'));
    expect(screen.getByText('1 / 5 PIECE SELECTED')).toBeTruthy();
    expect(screen.getByTestId('look-save')).toBeDisabled();

    await fireEvent.press(screen.getByLabelText('Choose Bottom'));
    await fireEvent.press(screen.getByText('Düz jean'));
    expect(screen.getByText('2 / 5 PIECES SELECTED')).toBeTruthy();
    expect(screen.getByTestId('look-save')).toBeEnabled();
    expect(screen.getByLabelText('Change Top')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Look name'), 'Hafta içi');
    await fireEvent.press(screen.getByTestId('look-save'));
    await waitFor(() => expect(fixtureDb.looks.find((l) => l.name === 'Hafta içi')).toBeTruthy(), { timeout: 3000 });
    expect(fixtureDb.looks.find((l) => l.name === 'Hafta içi')?.slots.map((s) => s.refId)).toEqual(['item_white_shirt', 'item_straight_jeans']);
  });

  it('preselects pieces passed from the wardrobe multi-select', async () => {
    await renderRouter('./src/app', { initialUrl: '/look/new?itemIds=item_navy_blazer,item_croc_flats,item_beige_trench' });
    await waitFor(() => expect(screen.getByText('2 / 5 PIECES SELECTED')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText('Lacivert yün blazer')).toBeTruthy();
    expect(screen.getByText('Kroko babet')).toBeTruthy();
    expect(screen.getByText(/1 piece couldn't be placed/)).toBeTruthy();
    expect(screen.getByTestId('look-save')).toBeEnabled();
  });

  it('opens a saved look in edit mode and flags a deleted piece', async () => {
    fixtureDb.items = fixtureDb.items.filter((i) => i.id !== 'item_navy_blazer');
    await renderRouter('./src/app', { initialUrl: '/look/new?id=look_lacivert_blazer' });
    await waitFor(() => expect(screen.getByText('Edit look')).toBeTruthy(), { timeout: 3000 });
    await waitFor(() => expect(screen.getByText('This piece was deleted from your wardrobe. Replace or remove it.')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByTestId('look-save')).toBeDisabled();
    expect(screen.getByText('Replace or remove the deleted piece to save.')).toBeTruthy();
  });
});
