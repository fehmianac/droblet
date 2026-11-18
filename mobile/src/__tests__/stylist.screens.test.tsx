import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { fixtureDb, resetFixtureDb } from '@/fixtures/db';
import { fixtureJobOptions, resetFixtureJobs } from '@/fixtures/jobs';
import { startFixtureStylistOutfit } from '@/fixtures/stylist';

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

beforeEach(async () => {
  resetFixtureDb();
  resetFixtureJobs();
  fixtureJobOptions.durationMs = 50;
  await AsyncStorage.clear();
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
});

describe('16 Stilist → 17 Kombin önerisi', () => {
  it('asks for an occasion, starts the job and shows three suggestions; dislike and add-to-calendar work', async () => {
    await renderRouter('./src/app', { initialUrl: '/stylist' });
    await waitFor(() => expect(screen.getByText('Suggest an outfit')).toBeTruthy(), WAIT);
    expect(screen.getByText('STYLE ADVISOR')).toBeTruthy();
    expect(screen.getByTestId('stylist-submit').props.accessibilityState.disabled).toBe(true);

    await fireEvent.press(screen.getByText('Dinner'));
    await waitFor(() => expect(screen.getByTestId('stylist-submit').props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(screen.getByTestId('stylist-submit'));

    await waitFor(() => expect(screen.getByText('SUGGESTION 1 / 3')).toBeTruthy(), WAIT);
    expect(screen.getByText('Gece Laciverti')).toBeTruthy();
    expect(screen.getByText('Try it on me')).toBeTruthy();

    // ✕ → feedback sheet → next suggestion
    await fireEvent.press(screen.getByLabelText('Not for me, next suggestion'));
    await waitFor(() => expect(screen.getByText("What didn't you like?")).toBeTruthy());
    await fireEvent.press(screen.getByText('The colours'));
    await fireEvent.press(screen.getByTestId('feedback-submit'));
    await waitFor(() => expect(screen.getByText('SUGGESTION 2 / 3')).toBeTruthy());
    expect(screen.getByText('You skipped this suggestion. Thanks for the feedback.')).toBeTruthy();

    // Takvime ekle → day sheet → look + plan day written
    const looksBefore = fixtureDb.looks.length;
    await fireEvent.press(screen.getByTestId('add-to-calendar'));
    await waitFor(() => expect(screen.getByText('Which day should we add it to?')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('calendar-confirm'));
    await waitFor(() => expect(screen.getByText('See the weekly plan')).toBeTruthy(), WAIT);
    await waitFor(() => expect(fixtureDb.looks).toHaveLength(looksBefore + 1), WAIT);
    const savedLook = fixtureDb.looks[0];
    expect(savedLook?.name).toBe('Krem Katmanlar');
    expect(fixtureDb.planDays.filter((d) => d.lookId === savedLook?.id)).toHaveLength(1);
    expect(screen.getByLabelText('Saved to lookbook')).toBeTruthy();
  }, 30_000);

  it('shows the stilist wait while the job runs', async () => {
    fixtureJobOptions.durationMs = 60_000;
    const { jobId } = startFixtureStylistOutfit({ requestId: 'wait', date: '2026-11-18', occasion: 'dinner', text: null, cityId: null, wardrobeOnly: true });
    await renderRouter('./src/app', { initialUrl: `/stylist/${jobId}?title=Dinner` });
    await waitFor(() => expect(screen.getByText('Looking through your wardrobe…')).toBeTruthy(), WAIT);
    expect(screen.getByText("Outfit suggestions don't use credits.")).toBeTruthy();
    expect(screen.getByLabelText("Show me when it's ready")).toBeTruthy();
  }, 30_000);

  it('a failed job shows the calm failure without a credit claim, and retry leads back to ask again', async () => {
    fixtureJobOptions.failNext = { code: 'generation_failed', creditRefunded: false };
    const { jobId } = startFixtureStylistOutfit({ requestId: 'fail', date: '2026-11-18', occasion: 'dinner', text: null, cityId: null, wardrobeOnly: true });
    await renderRouter('./src/app', { initialUrl: `/stylist/${jobId}` });
    await waitFor(() => expect(screen.getByText("We couldn't create it right now.")).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => expect(screen.getByText('Suggest an outfit')).toBeTruthy(), WAIT);
  }, 30_000);

  it('17b: with no credits left the suggestion shows the piece collage and "Add credits"', async () => {
    fixtureDb.entitlement.credits.remaining = 0;
    const { jobId } = startFixtureStylistOutfit({ requestId: 'nocredit', date: '2026-11-18', occasion: 'dinner', text: null, cityId: null, wardrobeOnly: true });
    await renderRouter('./src/app', { initialUrl: `/stylist/${jobId}` });
    await waitFor(() => expect(screen.getByText("This month's AI images are used up")).toBeTruthy(), WAIT);
    expect(screen.getByText('Piece collage')).toBeTruthy();
    expect(screen.getByText('Add credits')).toBeTruthy();
    expect(screen.queryByText('Try it on me')).toBeNull();
    expect(screen.getByTestId('add-to-calendar')).toBeTruthy();
  }, 30_000);

  it('17c: "Try it on me" confirms the credit, then shows the generating state', async () => {
    const { jobId } = startFixtureStylistOutfit({ requestId: 'tryon', date: '2026-11-18', occasion: 'dinner', text: null, cityId: null, wardrobeOnly: true });
    await renderRouter('./src/app', { initialUrl: `/stylist/${jobId}` });
    await waitFor(() => expect(screen.getByText('Try it on me')).toBeTruthy(), WAIT);
    fixtureJobOptions.durationMs = 60_000;
    await fireEvent.press(screen.getByText('Try it on me'));
    await waitFor(() => expect(screen.getByTestId('credit-confirm')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('credit-confirm'));
    await waitFor(() => expect(screen.getByText('Continue without the image')).toBeTruthy(), WAIT);
    expect(screen.getByText('Getting the pieces ready…')).toBeTruthy();
    expect(fixtureDb.entitlement.credits.remaining).toBe(10);
    await fireEvent.press(screen.getByText('Continue without the image'));
    await waitFor(() => expect(screen.getByTestId('add-to-calendar')).toBeTruthy());
  }, 30_000);
});
