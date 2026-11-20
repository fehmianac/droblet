import AsyncStorage from '@react-native-async-storage/async-storage';
import { userEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { fixtureDb, resetFixtureDb } from '@/fixtures/db';
import { fixtureCreateDrafts, fixtureDraftOptions, fixtureListDrafts, resetFixtureDrafts, setFixtureItemRecognition } from '@/fixtures/wardrobe';

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
// The system camera / photo library cannot run in tests: the picker hands over prepared photos at once.
const mockPicked: { photos: { uploadId: string; localUri: string; width: number; height: number }[] } = { photos: [] };
jest.mock('@/features/photos/usePhotoPicker', () => ({
  usePhotoPicker: ({ onPicked }: { onPicked: (photos: unknown[]) => void }) => ({
    takePhoto: () => onPicked(mockPicked.photos.slice(0, 1)),
    chooseFromLibrary: (limit: number) => onPicked(mockPicked.photos.slice(0, limit)),
    sheet: null,
  }),
}));
const photo = (n: number) => ({ uploadId: `up_${n}`, localUri: `file://photo-${n}.jpg`, width: 1200, height: 1600 });
/** Lets the entitlement (fixture latency) settle so the screen knows the quota. */
const settle = () => waitFor(() => new Promise<void>((resolve) => setTimeout(resolve, 700)), { timeout: 2000 });

jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));

const WAIT = { timeout: 4000 };
/** 12+: a photo first offers "Try it on me first" / "Split into pieces" (nothing is recognised before) — these tests split. */
async function chooseSplit() {
  await waitFor(() => expect(screen.getByTestId('tryFirst.split')).toBeTruthy(), WAIT);
  await fireEvent.press(screen.getByTestId('tryFirst.split'));
}


async function open(initialUrl: string) {
  // A fresh persisted cache per test (same user id): otherwise the previous test's wardrobe is restored.
  await AsyncStorage.removeItem('droblet.query.u1');
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
  await renderRouter('./src/app', { initialUrl });
}

beforeEach(() => {
  resetFixtureDb();
  resetFixtureDrafts();
});

describe('10 Parçalar', () => {
  it('shows the seeded wardrobe with its count, filters by category chip and selects pieces', async () => {
    await open('/wardrobe');
    await waitFor(() => expect(screen.getByText('Lacivert yün blazer')).toBeTruthy(), WAIT);
    expect(screen.getByText('YOUR WARDROBE')).toBeTruthy();
    expect(screen.getByText(`${fixtureDb.items.length} pieces`)).toBeTruthy();
    expect(screen.getByLabelText('Filter and sort')).toBeTruthy();

    await fireEvent.press(screen.getByText('Shoes'));
    await waitFor(() => expect(screen.queryByText('Lacivert yün blazer')).toBeNull());
    expect(screen.getByText('Kroko babet')).toBeTruthy();

    await fireEvent.press(screen.getByText('Select'));
    await waitFor(() => expect(screen.getByText('0 pieces selected')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Select Kroko babet'));
    await waitFor(() => expect(screen.getByText('1 piece selected')).toBeTruthy(), WAIT);
    expect(screen.getByText('Create look')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
  });

  it('draws the row of applied filters: outlined "all" badges, the sort and the long-press hint', async () => {
    await open('/wardrobe');
    await waitFor(() => expect(screen.getByText('Lacivert yün blazer')).toBeTruthy(), WAIT);
    expect(screen.getByText('All seasons')).toBeTruthy();
    expect(screen.getByText('All colours')).toBeTruthy();
    expect(screen.getByText('Newest · Long-press to select several')).toBeTruthy();
    expect(screen.getByLabelText('Search your wardrobe')).toBeTruthy();
    expect(screen.getByTestId('wardrobe-add').props.accessibilityState.disabled).toBe(false);

    await fireEvent.press(screen.getByLabelText('Filter and sort'));
    await fireEvent.press(await screen.findByText('Autumn'));
    await fireEvent.press(screen.getByTestId('filter-apply'));
    // The applied season replaces "All seasons" as a filled badge.
    await waitFor(() => expect(screen.queryByText('All seasons')).toBeNull());
    expect(screen.getByText('Autumn')).toBeTruthy();
  });

  it('multi-select: the selection bar takes the place of the bottom menu and holds Create look · Season · Delete', async () => {
    await open('/wardrobe');
    await waitFor(() => expect(screen.getByText('Kroko babet')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('tab-bar')).toBeTruthy();
    expect(screen.queryByTestId('selection-bar')).toBeNull();

    await fireEvent.press(screen.getByText('Select'));
    await waitFor(() => expect(screen.getByTestId('selection-bar')).toBeTruthy());
    await waitFor(() => expect(screen.queryByTestId('tab-bar')).toBeNull());
    // Nothing chosen yet: the three actions are there but disabled.
    expect(screen.getByLabelText('Create look').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText('Season').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId('selection-delete').props.accessibilityState.disabled).toBe(true);

    await fireEvent.press(screen.getByLabelText('Select Kroko babet'));
    await waitFor(() => expect(screen.getByText('1 piece selected')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('selection-delete').props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(screen.getByTestId('selection-delete'));
    await waitFor(() => expect(screen.getByText('Delete 1 piece?')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Delete from wardrobe'));
    await waitFor(() => expect(fixtureDb.items.some((i) => i.name === 'Kroko babet')).toBe(false), WAIT);

    // Leaving selection brings the bottom menu back.
    await waitFor(() => expect(screen.queryByTestId('selection-bar')).toBeNull());
    await waitFor(() => expect(screen.getByTestId('tab-bar')).toBeTruthy());
  });

  it('enters multi-select on long-press', async () => {
    await open('/wardrobe');
    await waitFor(() => expect(screen.getByText('Kroko babet')).toBeTruthy(), WAIT);
    await userEvent.setup().longPress(screen.getByLabelText('Kroko babet'), { duration: 800 });
    await waitFor(() => expect(screen.getByText('1 piece selected')).toBeTruthy(), WAIT);
    expect(screen.getByLabelText('Kroko babet, selected')).toBeTruthy();
  });

  it('filter sheet previews the result count and applies season + sort', async () => {
    await open('/wardrobe');
    await waitFor(() => expect(screen.getByText('Lacivert yün blazer')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByLabelText('Filter and sort'));
    await waitFor(() => expect(screen.getByText('SORT BY')).toBeTruthy());
    expect(screen.getByText(`Show ${fixtureDb.items.length} pieces`)).toBeTruthy();
    await fireEvent.press(screen.getByText('Summer'));
    const summer = fixtureDb.items.filter((i) => i.seasons.includes('summer')).length;
    await waitFor(() => expect(screen.getByText(`Show ${summer} pieces`)).toBeTruthy());
    await fireEvent.press(screen.getByText('Most worn'));
    await fireEvent.press(screen.getByTestId('filter-apply'));
    await waitFor(() => expect(screen.queryByText('Lacivert yün blazer')).toBeNull());
    expect(screen.getByText('Düz jean')).toBeTruthy();
    expect(screen.getByLabelText('Filter and sort, 2 filters active')).toBeTruthy();
  });

  it('shows the empty state with both ways to add a piece', async () => {
    resetFixtureDb({ empty: true });
    await open('/wardrobe');
    await waitFor(() => expect(screen.getByText('Your wardrobe is empty')).toBeTruthy(), WAIT);
    expect(screen.getByText('0 pieces')).toBeTruthy();
    expect(screen.getByText('Add your first piece')).toBeTruthy();
    expect(screen.getByText('Choose from the ready-made library')).toBeTruthy();
    // Through the shared ScreenState; no search / select while there is nothing to search.
    expect(screen.getByTestId('state-empty')).toBeTruthy();
    expect(screen.queryByText('Select')).toBeNull();
    expect(screen.queryByTestId('wardrobe.searchToggle')).toBeNull();
    await fireEvent.press(screen.getByText('Choose from the ready-made library'));
    await waitFor(() => expect(screen).toHavePathname('/item/library'), WAIT);
  });

  it('offers to clear filters when nothing matches', async () => {
    await open('/wardrobe');
    await waitFor(() => expect(screen.getByText('Lacivert yün blazer')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByText('Skiwear'));
    await waitFor(() => expect(screen.getByText('No pieces match this search or filter.')).toBeTruthy());
    await fireEvent.press(screen.getByText('Clear filters'));
    await waitFor(() => expect(screen.getByText('Lacivert yün blazer')).toBeTruthy());
  });
});

describe('11 Parça detayı', () => {
  it('shows the piece, its facts and looks, and the ⋯ menu', async () => {
    await open('/item/item_navy_blazer');
    await waitFor(() => expect(screen.getByText('Lacivert yün blazer')).toBeTruthy(), WAIT);
    expect(screen.getByText('OUTERWEAR · AUTUMN, WINTER')).toBeTruthy();
    expect(screen.getByText('6 times')).toBeTruthy();
    expect(screen.getByText('Looks with this piece')).toBeTruthy();
    // Canvas: the look tiles carry only the occasion tag; the name is the tile's accessible name.
    expect(screen.getByLabelText('Lacivert Blazer')).toBeTruthy();
    expect(screen.getByText('Soon')).toBeTruthy();
    expect(screen.getByText('Style an outfit with this')).toBeTruthy();
    expect(screen.getByLabelText('Products that complete this piece')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('More'));
    await waitFor(() => expect(screen.getByText('Change season')).toBeTruthy());
    expect(screen.getByText('Delete from wardrobe')).toBeTruthy();
  });

  it('deletes the piece after an explicit confirmation', async () => {
    await open('/item/item_silk_scarf');
    await waitFor(() => expect(screen.getByText('İpek fular')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByLabelText('More'));
    await fireEvent.press(await screen.findByText('Delete from wardrobe'));
    await waitFor(() => expect(screen.getByText('Delete this piece?')).toBeTruthy());
    expect(fixtureDb.items.some((i) => i.id === 'item_silk_scarf')).toBe(true);
    await fireEvent.press(screen.getByLabelText('Delete from wardrobe'));
    await waitFor(() => expect(fixtureDb.items.some((i) => i.id === 'item_silk_scarf')).toBe(false), WAIT);
  });

  it('explains a piece that no longer exists', async () => {
    await open('/item/item_missing');
    // A 404 is never retried, so the state shows at once.
    await waitFor(() => expect(screen.getByText('This piece is no longer in your wardrobe.')).toBeTruthy(), WAIT);
    expect(screen.queryByText('Try again')).toBeNull();
  });
});

describe('12c Parça bilgisi', () => {
  it('blocks saving until at least one season is selected', async () => {
    await open('/item/form?itemId=item_navy_blazer');
    await waitFor(() => expect(screen.getByDisplayValue('Lacivert yün blazer')).toBeTruthy(), WAIT);
    const save = () => screen.getByTestId('item-form-save');
    expect(save().props.accessibilityState.disabled).toBe(false);

    await fireEvent.press(screen.getByText('Autumn'));
    await fireEvent.press(screen.getByText('Winter'));
    await waitFor(() => expect(screen.getByText('Choose at least one season to save.')).toBeTruthy());
    expect(save().props.accessibilityState.disabled).toBe(true);

    await fireEvent.press(screen.getByText('Spring'));
    await waitFor(() => expect(screen.queryByText('Choose at least one season to save.')).toBeNull());
    expect(save().props.accessibilityState.disabled).toBe(false);
  });
});

describe('12c Parça bilgisi — nothing to edit', () => {
  it('explains a piece that no longer exists instead of an error', async () => {
    await open('/item/form?itemId=item_missing');
    await waitFor(() => expect(screen.getByText('This piece is no longer in your wardrobe.')).toBeTruthy(), WAIT);
    expect(screen.queryByText('Try again')).toBeNull();
    expect(screen.getByLabelText('Back to wardrobe')).toBeTruthy();
  });

  it('explains a draft that no longer exists', async () => {
    await open('/item/form?draftId=draft_missing');
    await waitFor(() => expect(screen.getByText('This draft no longer exists.')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('state-not-found')).toBeTruthy();
    expect(screen.getByLabelText('Back to wardrobe')).toBeTruthy();
  });
});

describe('12c Parça bilgisi — AI draft', () => {
  it('shows the suggestion for review and saves nothing until confirmed', async () => {
    fixtureDraftOptions.baseMs = 0;
    const { draftIds } = fixtureCreateDrafts({ requestId: 'req1', photoKeys: ['file:///photo.jpg'] });
    const before = fixtureDb.items.length;
    await open(`/item/form?draftId=${draftIds[0]}`);
    await waitFor(() => expect(screen.getByText('AI GUESS · PLEASE CHECK')).toBeTruthy(), WAIT);
    expect(screen.getByDisplayValue('Beyaz poplin gömlek')).toBeTruthy();
    expect(fixtureDb.items).toHaveLength(before);
    await fireEvent.press(screen.getByTestId('item-form-save'));
    await waitFor(() => expect(fixtureDb.items).toHaveLength(before + 1), WAIT);
    expect(fixtureDb.items[0]).toMatchObject({ name: 'Beyaz poplin gömlek', category: 'top', imageUrl: 'file:///photo.jpg' });
  });
});

describe('12b Hazır kütüphane', () => {
  it('counts the selection and enables "Add to wardrobe"', async () => {
    await open('/item/library');
    await waitFor(() => expect(screen.getByText('Bej trençkot')).toBeTruthy(), WAIT);
    expect(screen.getByText('0 pieces selected')).toBeTruthy();
    expect(screen.getByTestId('library-add').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByText('Bej trençkot'));
    await waitFor(() => expect(screen.getByText('1 piece selected')).toBeTruthy());
    expect(screen.getByTestId('library-add').props.accessibilityState.disabled).toBe(false);
  });
});

describe('13 Toplu ekle', () => {
  it('starts empty with the limit explained', async () => {
    await open('/item/bulk');
    await waitFor(() => expect(screen.getByText('Add several pieces at once')).toBeTruthy(), WAIT);
    expect(screen.getByText('Choose photos')).toBeTruthy();
    expect(screen.getByText(/up to 30 photos/i)).toBeTruthy();
    // Every photo runs the multi-item detection: there is no separate outfit-split mode any more.
    expect(screen.queryByText('Split an outfit photo')).toBeNull();
  });

  it('processing rows: the picked photo blurred and "Recognising…", then the recognised name with the cleaned image', async () => {
    const options = { ...fixtureDraftOptions };
    Object.assign(fixtureDraftOptions, { baseMs: 1200, stepMs: 1200, lowConfidenceEvery: 0 });
    try {
      mockPicked.photos = [photo(1), photo(2)];
      await open('/item/bulk');
      await waitFor(() => expect(screen.getByTestId('bulk-pick')).toBeTruthy(), WAIT);
      await settle();
      await fireEvent.press(screen.getByTestId('bulk-pick'));

      await waitFor(() => expect(screen.getAllByText('Recognising…')).toHaveLength(2), WAIT);
      // No generic "Photo N" titles while the name is unknown.
      expect(screen.queryByText('Photo 1')).toBeNull();
      expect(screen.getAllByTestId(/^bulk-tile-blurred-/)).toHaveLength(2);
      // Row bars are determinate (simulated, below 90 %); the header bar is their average, not an empty 0 / 2.
      expect(screen.getByLabelText('0 of 2 photos processed').props.accessibilityValue.now).toBeLessThan(90);

      await waitFor(() => expect(screen.getByText('Beyaz poplin gömlek')).toBeTruthy(), WAIT);
      expect(screen.getByText('Tops · White')).toBeTruthy();
      await waitFor(() => expect(screen.getByText('Düz jean')).toBeTruthy(), WAIT);
      expect(screen.queryByText('Recognising…')).toBeNull();
      expect(screen.getAllByTestId(/^bulk-tile-clean-/)).toHaveLength(2);
      expect(screen.getAllByLabelText('Background removed')).toHaveLength(2);
      expect(screen.getByLabelText('2 of 2 photos processed').props.accessibilityValue.now).toBe(100);
    } finally {
      Object.assign(fixtureDraftOptions, options);
    }
  }, 20_000);
});

describe('AI recognition quota (12, 13)', () => {
  beforeEach(() => {
    mockPicked.photos = [photo(1), photo(2), photo(3), photo(4)];
  }, 20_000);

  it('12: with no free recognition left the shutter opens the paywall and "Enter manually" still saves a piece', async () => {
    setFixtureItemRecognition(3, 3);
    await open('/item/add');
    await waitFor(() => expect(screen.getByTestId('item-add-manual')).toBeTruthy(), WAIT);
    await settle();
    await fireEvent.press(screen.getByTestId('item-add-shutter'));
    await chooseSplit();
    await waitFor(() => expect(screen).toHavePathname('/paywall'), WAIT);
    expect(fixtureListDrafts()).toHaveLength(0);

    await act(async () => router.back());
    await waitFor(() => expect(screen.getByText(/used your free AI recognitions/)).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('item-add-manual'));
    await waitFor(() => expect(screen).toHavePathname('/item/form'), WAIT);
    await waitFor(() => expect(screen.getByText('Piece details')).toBeTruthy(), WAIT);
    // The photo handed over before the paywall travels into the manual form.
    expect(screen.getByText(/Your photo is ready/)).toBeTruthy();
  }, 20_000);

  it('12: a 402 item_recognition_limit_reached from the server opens the paywall and keeps the manual path', async () => {
    setFixtureItemRecognition(3, 2);
    await open('/item/add');
    await waitFor(() => expect(screen.getByTestId('item-add-shutter')).toBeTruthy(), WAIT);
    await settle();
    // The last free recognition is used elsewhere: the app still believes one is left, the server says 402.
    setFixtureItemRecognition(3, 3);
    await fireEvent.press(screen.getByTestId('item-add-shutter'));
    await chooseSplit();
    await waitFor(() => expect(screen).toHavePathname('/paywall'), WAIT);
    expect(fixtureListDrafts()).toHaveLength(0);

    await act(async () => router.back());
    await waitFor(() => expect(screen.getByText(/used your free AI recognitions/)).toBeTruthy(), WAIT);
    expect(screen.getByText('Enter manually')).toBeTruthy();
  }, 20_000);

  it('12: the manual path is there for members too', async () => {
    await open('/item/add');
    await waitFor(() => expect(screen.getByText('Enter manually')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('item-add-manual'));
    await waitFor(() => expect(screen).toHavePathname('/item/form'), WAIT);
  }, 20_000);

  it('13: processes the photos that fit the quota and says how many were skipped', async () => {
    setFixtureItemRecognition(5, 3);
    await open('/item/bulk');
    await waitFor(() => expect(screen.getByTestId('bulk-pick')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('bulk-manual')).toBeTruthy();
    await settle();
    await fireEvent.press(screen.getByTestId('bulk-pick'));
    await waitFor(() => expect(screen.getByText(/2 photos were not processed/)).toBeTruthy(), WAIT);
    await waitFor(() => expect(fixtureListDrafts()).toHaveLength(2), WAIT);
    await waitFor(() => expect(screen.getByText('Become a member')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('bulk-manual-notice')).toBeTruthy();
  }, 20_000);

  it('13: with nothing left the paywall opens and no photo is sent', async () => {
    setFixtureItemRecognition(2, 2);
    await open('/item/bulk');
    await waitFor(() => expect(screen.getByTestId('bulk-pick')).toBeTruthy(), WAIT);
    await settle();
    await fireEvent.press(screen.getByTestId('bulk-pick'));
    await waitFor(() => expect(screen).toHavePathname('/paywall'), WAIT);
    expect(fixtureListDrafts()).toHaveLength(0);
  }, 20_000);

  it('13: photos picked before a 402 from the server are not lost — "Enter manually" opens the form with the photo', async () => {
    setFixtureItemRecognition(2, 1);
    await open('/item/bulk');
    await waitFor(() => expect(screen.getByTestId('bulk-pick')).toBeTruthy(), WAIT);
    await settle();
    // The last free recognition is used elsewhere: the app still believes one is left, the server says 402.
    setFixtureItemRecognition(2, 2);
    await fireEvent.press(screen.getByTestId('bulk-pick'));
    await waitFor(() => expect(screen).toHavePathname('/paywall'), WAIT);
    expect(fixtureListDrafts()).toHaveLength(0);

    await act(async () => router.back());
    await waitFor(() => expect(screen.getByTestId('bulk-manual')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('bulk-manual'));
    await waitFor(() => expect(screen).toHavePathname('/item/form'), WAIT);
    await waitFor(() => expect(screen.getByText(/Your photo is ready/)).toBeTruthy(), WAIT);
    expect(screen.getByText('ORIGINAL')).toBeTruthy();
  }, 20_000);
});
