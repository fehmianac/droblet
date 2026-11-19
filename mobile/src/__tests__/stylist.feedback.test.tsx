import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { fixtureDb, resetFixtureDb } from '@/fixtures/db';
import { fixtureJobOptions, resetFixtureJobs } from '@/fixtures/jobs';
import { startFixtureStylistOutfit } from '@/fixtures/stylist';
import { hideToast } from '@/components/ui/toast';
import { toIsoDate } from '@/lib/format';

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

const WAIT = { timeout: 6000 };
const today = toIsoDate(new Date());

beforeEach(async () => {
  resetFixtureDb();
  resetFixtureJobs();
  hideToast();
  fixtureJobOptions.durationMs = 50;
  await AsyncStorage.clear();
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
});

async function openSuggestions(requestId: string) {
  const { jobId } = startFixtureStylistOutfit({ requestId, date: today, occasion: 'dinner', text: null, cityId: null, wardrobeOnly: true });
  await renderRouter('./src/app', { initialUrl: `/stylist/${jobId}` });
  await waitFor(() => expect(screen.getByText('SUGGESTION 1 / 3')).toBeTruthy(), WAIT);
}

const toastText = () => screen.getByTestId('toast-message').props.children as string;

describe('13c 16b — the heart', () => {
  it('saves with a toast ("View"), unsaves with "Undo", and undo saves again', async () => {
    await openSuggestions('heart');
    const before = fixtureDb.looks.length;

    await fireEvent.press(screen.getByTestId('save-suggestion'));
    await waitFor(() => expect(screen.getByTestId('toast-saved')).toBeTruthy());
    expect(toastText()).toBe('Saved to your looks');
    expect(screen.getByTestId('toast-action').props.accessibilityLabel).toBe('View');
    await waitFor(() => expect(fixtureDb.looks).toHaveLength(before + 1), WAIT);
    expect(screen.getByLabelText('Remove from lookbook')).toBeTruthy();

    // A filled heart that is not on the calendar: the look made from this suggestion is deleted.
    await fireEvent.press(screen.getByTestId('save-suggestion'));
    await waitFor(() => expect(screen.getByTestId('toast-unsaved')).toBeTruthy());
    expect(toastText()).toBe('Removed from saved');
    await waitFor(() => expect(fixtureDb.looks).toHaveLength(before), WAIT);
    expect(screen.getByLabelText('Save to lookbook')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('toast-action'));
    await waitFor(() => expect(fixtureDb.looks).toHaveLength(before + 1), WAIT);
    expect(screen.getByLabelText('Remove from lookbook')).toBeTruthy();
  }, 30_000);
});

describe('13c 16b — Takvime ekle', () => {
  it('a saved look is planned with the plan-day write; a busy day says it is replaced; remove takes it off', async () => {
    // Every day of the sheet already has another look planned.
    const other = fixtureDb.looks[1]?.id ?? 'look-other';
    for (let i = 0; i < 8; i += 1) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const date = toIsoDate(d);
      fixtureDb.planDays = [...fixtureDb.planDays.filter((p) => p.date !== date), { date, occasion: 'office', lookId: other, baseVersion: 1 }];
    }
    await openSuggestions('calendar');
    const before = fixtureDb.looks.length;

    await fireEvent.press(screen.getByTestId('save-suggestion'));
    await waitFor(() => expect(fixtureDb.looks).toHaveLength(before + 1), WAIT);
    const saved = fixtureDb.looks[0];

    await fireEvent.press(screen.getByTestId('add-to-calendar'));
    await waitFor(() => expect(screen.getByText('Which day should we add it to?')).toBeTruthy());
    // The chosen day already has a plan: the sheet says so, the chip carries a dot.
    await waitFor(() => expect(screen.getByTestId('calendar-replaces')).toBeTruthy(), WAIT);
    expect(screen.getByText("That day's plan will change to this outfit.")).toBeTruthy();
    expect(screen.getByTestId(`calendar-day-${today}.dot`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('calendar-confirm'));

    await waitFor(() => expect(screen.getByTestId('toast-calendar')).toBeTruthy());
    // Replaced, and no "also saved" — the look was saved by the heart.
    expect(toastText()).toMatch(/plan updated$/);
    expect(screen.getByTestId('toast-action').props.accessibilityLabel).toBe('See calendar');
    await waitFor(() => expect(fixtureDb.planDays.find((p) => p.date === today)?.lookId).toBe(saved?.id), WAIT);
    // No second look was created (the old accept would have 409'd on the server).
    expect(fixtureDb.looks).toHaveLength(before + 1);
    expect(screen.getByTestId('in-calendar')).toBeTruthy();

    // A planned look stays when the heart is tapped.
    await fireEvent.press(screen.getByTestId('save-suggestion'));
    await waitFor(() => expect(screen.getByTestId('toast-kept-planned')).toBeTruthy());
    expect(fixtureDb.looks).toHaveLength(before + 1);

    // "Takvimde · …" → remove from calendar.
    await fireEvent.press(screen.getByTestId('in-calendar'));
    await waitFor(() => expect(screen.getByTestId('planned-remove')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('planned-remove'));
    await waitFor(() => expect(screen.getByTestId('toast-calendar-removed')).toBeTruthy());
    await waitFor(() => expect(fixtureDb.planDays.find((p) => p.date === today)).toBeUndefined(), WAIT);
    expect(screen.getByTestId('add-to-calendar')).toBeTruthy();
  }, 30_000);
});
