import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { fixtureDb, resetFixtureDb } from '@/fixtures/db';
import { fixtureFailPhoto, fixtureGetImport, fixtureOpenImports } from '@/features/outfitImport/fixtures';
import { resetUploads } from '@/features/outfitImport/uploader';

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
jest.mock('@/features/photos/preparePhoto', () => ({
  preparePhoto: jest.fn(),
  deleteLocalPhoto: jest.fn(),
}));

/** The gallery picker: the test decides how many photos come back; the limit the screen asked for is recorded. */
const mockPicker = { count: 3, limits: [] as number[], maxEdges: [] as (number | undefined)[] };
jest.mock('@/features/photos/usePhotoPicker', () => ({
  usePhotoPicker: (options: { onPicked: (photos: { uploadId: string; localUri: string; width: number; height: number }[]) => void; maxEdge?: number }) => ({
    takePhoto: jest.fn(),
    chooseFromLibrary: (limit: number) => {
      mockPicker.limits.push(limit);
      mockPicker.maxEdges.push(options.maxEdge);
      options.onPicked(Array.from({ length: mockPicker.count }, (_, i) => ({ uploadId: `u${i}`, localUri: `file:///outfit-${i}.jpg`, width: 1200, height: 1600 })));
    },
    sheet: null,
  }),
}));

const WAIT = { timeout: 6000 };

async function open(initialUrl: string) {
  await AsyncStorage.removeItem('droblet.query.u1');
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
  await renderRouter('./src/app', { initialUrl });
}

beforeEach(() => {
  resetFixtureDb();
  resetUploads();
  mockPicker.count = 3;
  mockPicker.limits = [];
  mockPicker.maxEdges = [];
});

describe('14a Looklar "+" menu', () => {
  it('offers "Create a look" and "Import your outfits" with the plan limit from the server', async () => {
    await open('/wardrobe/looks');
    await waitFor(() => expect(screen.getByText('Lacivert Blazer')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByLabelText('Add'));
    await waitFor(() => expect(screen.getByTestId('looks.addSheet')).toBeTruthy(), WAIT);
    expect(screen.getByText('What would you like to add?')).toBeTruthy();
    expect(screen.getByText('Turn outfit photos from your gallery into looks · up to 30 photos')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('looks.addSheet.import'));
    await waitFor(() => expect(screen).toHavePathname('/import'), WAIT);
  });

  it('follows another plan limit without an app change', async () => {
    fixtureDb.entitlement.outfitImportMaxPhotos = 12;
    await open('/wardrobe/looks');
    await waitFor(() => expect(screen.getByText('Lacivert Blazer')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByLabelText('Add'));
    await waitFor(() => expect(screen.getByText('Turn outfit photos from your gallery into looks · up to 12 photos')).toBeTruthy(), WAIT);
  });
});

describe('31 Import your outfits', () => {
  it('shows the steps and, for a free user, the recognitions left; the picker takes min(limit, left)', async () => {
    fixtureDb.entitlement.tier = 'free';
    fixtureDb.entitlement.itemRecognition = { limit: 10, used: 3, remaining: 7 };
    await open('/import');
    await waitFor(() => expect(screen.getByText("Let's turn your photos into looks")).toBeTruthy(), WAIT);
    await waitFor(() => expect(screen.getByText('Pick up to 30 outfit photos from your gallery.')).toBeTruthy(), WAIT);
    await waitFor(() => expect(screen.getByTestId('import.quota')).toBeTruthy(), WAIT);
    expect(screen.getByText('You can choose up to 7 photos (your recognitions left)')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('import.pick'));
    await waitFor(() => expect(mockPicker.limits).toEqual([7]), WAIT);
    expect(mockPicker.maxEdges).toEqual([1600]);   // compressed on the device to a 1600 px long edge
  });

  it('shows the membership state when the free recognitions are used up', async () => {
    fixtureDb.entitlement.tier = 'free';
    fixtureDb.entitlement.itemRecognition = { limit: 10, used: 10, remaining: 0 };
    await open('/import');
    await waitFor(() => expect(screen.getByTestId('import.quotaExhausted')).toBeTruthy(), WAIT);
    expect(screen.getByText('Your free recognitions are used up')).toBeTruthy();
    expect(screen.getByText('Become a member')).toBeTruthy();
  });

  it('uploads, processes, reviews with "In your wardrobe" / "New" tags and approves', async () => {
    await open('/import');
    await waitFor(() => expect(screen.getByText('You can choose up to 30 photos')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('import.pick'));

    // Every photo is ready (fixtures): the review opens with one look card per photo.
    await waitFor(() => expect(screen.getByTestId('import.look.1')).toBeTruthy(), WAIT);
    await waitFor(() => expect(screen.getByTestId('import.look.1')).toBeTruthy(), WAIT);
    expect(screen.getByText('3 looks ready')).toBeTruthy();
    expect(screen.getAllByText('In your wardrobe').length).toBe(3);
    expect(screen.getAllByText('New').length).toBe(6);
    // The same new shirt in three photos is one piece.
    expect(screen.getByText('Approve · 3 looks, 4 new pieces')).toBeTruthy();
    expect(screen.getAllByText('Also in photo 2 and 3').length).toBe(1);

    // Switch photo 2 off, untick the jeans of photo 1.
    await fireEvent(screen.getByTestId('import.look.2.switch'), 'valueChange', false);
    await fireEvent.press(screen.getAllByLabelText('Düz jean: add')[0]!);
    await waitFor(() => expect(screen.getByText('Approve · 2 looks, 2 new pieces')).toBeTruthy(), WAIT);

    await fireEvent.press(screen.getByTestId('import.approve'));
    await waitFor(() => expect(screen.getByTestId('import.done')).toBeTruthy(), WAIT);
    expect(screen.getByText('2 looks in your Looks')).toBeTruthy();
    expect(screen.getByText(/2 new pieces were added to your wardrobe/)).toBeTruthy();
  });

  it('shows the empty state when no photo gave a piece', async () => {
    mockPicker.count = 1;
    await open('/import');
    await waitFor(() => expect(screen.getByText('You can choose up to 30 photos')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('import.pick'));
    await waitFor(() => expect(screen.getByTestId('import.look.1')).toBeTruthy(), WAIT);
    const id = fixtureOpenImports()[0]?.id;
    expect(id).toBeTruthy();
    fixtureFailPhoto(id!, 1);
    expect(fixtureGetImport(id!)?.status).toBe('failed');
    await open(`/import/${id}`);
    await waitFor(() => expect(screen.getByTestId('import.noPieces')).toBeTruthy(), WAIT);
    expect(screen.getByText('We found no pieces in these photos')).toBeTruthy();
  });
});

describe('12 Parça ekle', () => {
  it('has "Import your outfits" next to "Bulk"', async () => {
    await open('/item/add');
    await waitFor(() => expect(screen.getByTestId('item-add-import')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('item-add-bulk')).toBeTruthy();
  });
});
