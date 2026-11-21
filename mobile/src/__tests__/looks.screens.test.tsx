import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Share } from 'react-native';

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

  it('draws the header action, the occasion tags and opens a look from its card', async () => {
    await renderRouter('./src/app', { initialUrl: '/wardrobe/looks' });
    await waitFor(() => expect(screen.getByText('Lacivert Blazer')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByTestId('looks.create')).toBeTruthy();
    expect(screen.getByLabelText('Add')).toBeTruthy();
    expect(screen.getAllByText('OFFICE').length).toBe(2);
    expect(screen.getByText('EVENING')).toBeTruthy();
    expect(screen.getByText('WEEKEND')).toBeTruthy();
    // No rendered image in the fixtures: every card lays its pieces out flat (21c, glyph on the piece's colour), never an empty box.
    expect(screen.getAllByTestId('image-slot-flatlay').length).toBe(4);
    expect(screen.queryByTestId('image-slot-collage')).toBeNull();
    expect(screen.getAllByTestId('image-slot-garment').length).toBeGreaterThanOrEqual(8);
    expect(screen.queryByText('ON YOU')).toBeNull();
    // A look nobody rated shows no rating.
    expect(screen.getByLabelText('Weekend, Tüvit & Jean')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Evening, Siyah Düz Elbise, average rating 4.8'));
    await waitFor(() => expect(screen).toHavePathname('/look/look_siyah_duz_elbise'), { timeout: 3000 });
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
    await waitFor(() => expect(screen.getByText('Your lookbook is empty')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText('Put your pieces together and create your first look.')).toBeTruthy();
    expect(screen.getByTestId('empty-illustration-looks', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('Create a look')).toBeTruthy();
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
    // The hint stays in the bottom bar next to Save, as drawn.
    expect(screen.getByText('Save unlocks once at least 2 pieces are selected.')).toBeTruthy();
    expect(screen.getByText('At least 2 pieces')).toBeTruthy();
    expect(screen.getByText('PREVIEW')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Look name'), 'Hafta içi');
    await fireEvent.press(screen.getByTestId('look-save'));
    await waitFor(() => expect(fixtureDb.looks.find((l) => l.name === 'Hafta içi')).toBeTruthy(), { timeout: 3000 });
    expect(fixtureDb.looks.find((l) => l.name === 'Hafta içi')?.slots.map((s) => s.refId)).toEqual(['item_white_shirt', 'item_straight_jeans']);
  });

  it('a new look: "Try it on me" waits for the look to be saved before the job starts', async () => {
    await renderRouter('./src/app', { initialUrl: '/look/new?itemIds=item_white_shirt,item_straight_jeans' });
    await waitFor(() => expect(screen.getByText('2 / 5 PIECES SELECTED')).toBeTruthy(), { timeout: 3000 });
    await fireEvent.changeText(screen.getByLabelText('Look name'), 'Deneme');
    await fireEvent.press(screen.getByTestId('look-try-on'));
    await waitFor(() => expect(screen.getByTestId('credit-confirm')).toBeTruthy(), { timeout: 3000 });
    await fireEvent.press(screen.getByTestId('credit-confirm'));
    // Started on a look the server already holds: the job screen takes over, no "couldn't be started" note.
    await waitFor(() => expect(screen).not.toHavePathname('/look/new'), { timeout: 3000 });
    expect(fixtureDb.looks.find((l) => l.name === 'Deneme')).toBeTruthy();
    expect(screen.queryByText(/couldn't be started/)).toBeNull();
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

describe('Look detail (derived from 17)', () => {
  it('shows the look with its pieces and rating; a piece opens its detail', async () => {
    await renderRouter('./src/app', { initialUrl: '/look/look_lacivert_blazer' });
    await waitFor(() => expect(screen.getByText('Lacivert Blazer')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText('OFFICE · 3 PIECES')).toBeTruthy();
    expect(screen.getByLabelText("Your friends' average rating 4.6, 12 ratings")).toBeTruthy();
    expect(screen.getByLabelText('Beyaz poplin gömlek, Top · Your wardrobe')).toBeTruthy();
    expect(screen.getByLabelText('Lacivert yün blazer, Outerwear · Your wardrobe')).toBeTruthy();
    expect(screen.getByTestId('look-try-on')).toBeEnabled();

    await fireEvent.press(screen.getByLabelText('Lacivert yün blazer, Outerwear · Your wardrobe'));
    await waitFor(() => expect(screen).toHavePathname('/item/item_navy_blazer'), { timeout: 3000 });
  });

  it('marks a store piece as missing and offers to complete the look', async () => {
    const look = fixtureDb.looks.find((l) => l.id === 'look_lacivert_blazer');
    look?.slots.push({ slot: 'shoes', source: 'store', refId: 'prod_rain_boots', name: 'Yağmur botu', imageUrl: null, brand: 'Gap', price: null, deleted: false });
    await renderRouter('./src/app', { initialUrl: '/look/look_lacivert_blazer' });
    await waitFor(() => expect(screen.getByText('Yağmur botu')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText('Missing piece · Store')).toBeTruthy();
    expect(screen.getByText("1 piece isn't in your wardrobe; you can complete it from the store.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Complete the look: Yağmur botu'));
    await waitFor(() => expect(screen).toHavePathname('/shop/product/prod_rain_boots'), { timeout: 3000 });
  });

  it('shares the look as readable text', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    await renderRouter('./src/app', { initialUrl: '/look/look_lacivert_blazer' });
    await waitFor(() => expect(screen.getByTestId('look-share')).toBeTruthy(), { timeout: 3000 });
    await fireEvent.press(screen.getByTestId('look-share'));
    expect(share).toHaveBeenCalledTimes(1);
    const message = share.mock.calls[0]?.[0] as { message: string };
    expect(message.message).toContain('Lacivert Blazer · Office');
    expect(message.message).toContain('• Beyaz poplin gömlek');
    expect(message.message).toContain('• Lacivert yün blazer');
    share.mockRestore();
  });

  it('toggles the favourite and opens the editor from the bottom bar', async () => {
    await renderRouter('./src/app', { initialUrl: '/look/look_tuvit_jean' });
    await waitFor(() => expect(screen.getByLabelText('Tüvit & Jean: add to favourites')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText("Your friends haven't rated this look yet.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Tüvit & Jean: add to favourites'));
    await waitFor(() => expect(screen.getByLabelText('Tüvit & Jean: remove from favourites')).toBeTruthy());
    await waitFor(() => expect(fixtureDb.looks.find((l) => l.id === 'look_tuvit_jean')?.isFavorite).toBe(true), { timeout: 3000 });

    await fireEvent.press(screen.getByTestId('look-edit'));
    await waitFor(() => expect(screen.getByText('Edit look')).toBeTruthy(), { timeout: 3000 });
    expect(screen).toHavePathname('/look/new');
  });

  it('starts "Try it on me" behind the credit confirmation', async () => {
    await renderRouter('./src/app', { initialUrl: '/look/look_lacivert_blazer' });
    await waitFor(() => expect(screen.getByTestId('look-try-on')).toBeTruthy(), { timeout: 3000 });
    await fireEvent.press(screen.getByTestId('look-try-on'));
    await waitFor(() => expect(screen.getByText('1 credit will be used')).toBeTruthy(), { timeout: 3000 });
    await fireEvent.press(screen.getByTestId('credit-confirm'));
    // The job screen takes over (its path carries the job id).
    await waitFor(() => expect(screen.queryByTestId('look-try-on')).toBeNull(), { timeout: 3000 });
    expect(screen).not.toHavePathname('/look/look_lacivert_blazer');
    expect(fixtureDb.entitlement.credits.remaining).toBe(10);
  });

  it('marks the look as worn today from the menu', async () => {
    await renderRouter('./src/app', { initialUrl: '/look/look_lacivert_blazer' });
    await waitFor(() => expect(screen.getByLabelText('More')).toBeTruthy(), { timeout: 3000 });
    await fireEvent.press(screen.getByLabelText('More'));
    await fireEvent.press(screen.getByLabelText("I'm wearing this today"));
    await waitFor(() => expect(screen.getByText('Marked on today in your calendar.')).toBeTruthy());
  });

  it('deletes the look after confirmation', async () => {
    await renderRouter('./src/app', { initialUrl: '/look/look_krem_katmanlar' });
    await waitFor(() => expect(screen.getByLabelText('More')).toBeTruthy(), { timeout: 3000 });
    await fireEvent.press(screen.getByLabelText('More'));
    await fireEvent.press(screen.getByLabelText('Delete look'));
    expect(screen.getByText('Delete this look?')).toBeTruthy();
    expect(fixtureDb.looks.some((l) => l.id === 'look_krem_katmanlar')).toBe(true);
    await fireEvent.press(screen.getByTestId('look-delete-confirm'));
    await waitFor(() => expect(screen.getByText('This look was deleted.')).toBeTruthy(), { timeout: 3000 });
    await waitFor(() => expect(fixtureDb.looks.some((l) => l.id === 'look_krem_katmanlar')).toBe(false), { timeout: 3000 });
  });

  it('shows the not-found state (no retry) for an unknown look, with the way back to the lookbook', async () => {
    await renderRouter('./src/app', { initialUrl: '/look/nope' });
    await waitFor(() => expect(screen.getByText('This look is no longer in your lookbook.')).toBeTruthy(), { timeout: 3000 });
    expect(screen.queryByText('Try again')).toBeNull();
    expect(screen.queryByTestId('look-try-on')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Back to the lookbook'));
    await waitFor(() => expect(screen).toHavePathname('/wardrobe/looks'), { timeout: 3000 });
  });

  it('shows the not-found state when editing an unknown look', async () => {
    await renderRouter('./src/app', { initialUrl: '/look/new?id=nope' });
    await waitFor(() => expect(screen.getByText('This look is no longer in your lookbook.')).toBeTruthy(), { timeout: 3000 });
    expect(screen.queryByText('Try again')).toBeNull();
  });
});
