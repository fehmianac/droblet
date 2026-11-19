import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { AccessibilityInfo, Dimensions, Share } from 'react-native';

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
    // The leading chevron is named "Vazgeç" on the board.
    expect(screen.getByLabelText('Cancel')).toBeTruthy();
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

  it('17c: "Try it on me" confirms the credit, then shows the generating state on the image only — pieces and actions stay', async () => {
    const { jobId } = startFixtureStylistOutfit({ requestId: 'tryon', date: '2026-11-18', occasion: 'dinner', text: null, cityId: null, wardrobeOnly: true });
    await renderRouter('./src/app', { initialUrl: `/stylist/${jobId}` });
    await waitFor(() => expect(screen.getByText('Try it on me')).toBeTruthy(), WAIT);
    fixtureJobOptions.durationMs = 60_000;
    await fireEvent.press(screen.getByText('Try it on me'));
    await waitFor(() => expect(screen.getByTestId('credit-confirm')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('credit-confirm'));
    await waitFor(() => expect(screen.getByText('Getting the pieces ready…')).toBeTruthy(), WAIT);
    expect(fixtureDb.entitlement.credits.remaining).toBe(10);
    // Text first: no "continue without the image" gate — the calendar action and the share button are there while it renders.
    expect(screen.queryByText('Continue without the image')).toBeNull();
    expect(screen.getByTestId('add-to-calendar')).toBeTruthy();
    expect(screen.getByTestId('share-suggestion')).toBeTruthy();
  }, 30_000);

  it('16: header action, context badges and the wardrobe / store source toggle', async () => {
    await renderRouter('./src/app', { initialUrl: '/stylist' });
    await waitFor(() => expect(screen.getByText('Suggest an outfit')).toBeTruthy(), WAIT);
    expect(screen.getByLabelText('Past suggestions')).toBeTruthy();
    expect(screen.getByLabelText('Send')).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('Weather: 14° · Hafif yağmur')).toBeTruthy(), WAIT);
    const toggle = screen.getByTestId('wardrobe-only');
    expect(toggle.props.accessibilityState.checked).toBe(true);
    expect(screen.getByText('My wardrobe only')).toBeTruthy();
    await fireEvent.press(toggle);
    expect(screen.getByTestId('wardrobe-only').props.accessibilityState.checked).toBe(false);
    expect(screen.getByText('With store pieces')).toBeTruthy();
    for (const label of ['Pack a suitcase', 'Plan my week', 'Create a look', 'My colour palette']) expect(screen.getByLabelText(label)).toBeTruthy();
  }, 30_000);

  it('17: swiping moves between the three suggestions and the dots follow; the dots work without swiping', async () => {
    const { jobId } = startFixtureStylistOutfit({ requestId: 'swipe', date: '2026-11-18', occasion: 'dinner', text: null, cityId: null, wardrobeOnly: true });
    await renderRouter('./src/app', { initialUrl: `/stylist/${jobId}?title=Dinner` });
    await waitFor(() => expect(screen.getByText('SUGGESTION 1 / 3')).toBeTruthy(), WAIT);
    const width = Dimensions.get('window').width;
    const dots = () => screen.getByTestId('suggestion-dots');
    expect(dots().props.accessibilityValue).toEqual({ min: 1, max: 3, now: 1 });
    expect(screen.queryByText('SUGGESTION 2 / 3')).toBeNull();

    await fireEvent.scroll(screen.getByTestId('suggestion-pager'), { nativeEvent: { contentOffset: { x: width, y: 0 } } });
    await waitFor(() => expect(screen.getByText('SUGGESTION 2 / 3')).toBeTruthy());
    expect(screen.getByText('Krem Katmanlar')).toBeTruthy();
    expect(dots().props.accessibilityValue).toEqual({ min: 1, max: 3, now: 2 });
    expect(screen.getByLabelText('Suggestion 2 of 3.')).toBeTruthy();

    // Without swiping: a tap on the dots goes on (and wraps), the accessibility actions go both ways.
    await fireEvent.press(dots());
    await waitFor(() => expect(dots().props.accessibilityValue.now).toBe(3));
    await fireEvent.press(dots());
    await waitFor(() => expect(dots().props.accessibilityValue.now).toBe(1));
    await fireEvent(dots(), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    await waitFor(() => expect(screen.getByText('SUGGESTION 3 / 3')).toBeTruthy());
    await fireEvent(dots(), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    await waitFor(() => expect(screen.getByText('SUGGESTION 1 / 3')).toBeTruthy());
  }, 30_000);

  it('17: with reduce-motion the pager does not scroll or animate, and a sideways drag still turns the page', async () => {
    const reduce = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const { jobId } = startFixtureStylistOutfit({ requestId: 'calm', date: '2026-11-18', occasion: 'dinner', text: null, cityId: null, wardrobeOnly: true });
    await renderRouter('./src/app', { initialUrl: `/stylist/${jobId}` });
    await waitFor(() => expect(screen.getByText('SUGGESTION 1 / 3')).toBeTruthy(), WAIT);
    await waitFor(() => expect(screen.getByTestId('suggestion-pager').props.scrollEnabled).toBe(false), WAIT);
    const area = screen.getByTestId('suggestion-swipe');
    await fireEvent(area, 'touchStart', { nativeEvent: { pageX: 300, pageY: 200 } });
    await fireEvent(area, 'touchEnd', { nativeEvent: { pageX: 120, pageY: 210 } });
    await waitFor(() => expect(screen.getByText('SUGGESTION 2 / 3')).toBeTruthy());
    // A vertical drag is a scroll, not a page turn.
    await fireEvent(area, 'touchStart', { nativeEvent: { pageX: 300, pageY: 200 } });
    await fireEvent(area, 'touchEnd', { nativeEvent: { pageX: 240, pageY: 500 } });
    expect(screen.getByText('SUGGESTION 2 / 3')).toBeTruthy();
    await fireEvent(area, 'touchStart', { nativeEvent: { pageX: 120, pageY: 200 } });
    await fireEvent(area, 'touchEnd', { nativeEvent: { pageX: 300, pageY: 200 } });
    await waitFor(() => expect(screen.getByText('SUGGESTION 1 / 3')).toBeTruthy());
    reduce.mockResolvedValue(false);
  }, 30_000);

  it('17: "Share" sends the open suggestion as text through the system share sheet', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    const { jobId } = startFixtureStylistOutfit({ requestId: 'share', date: '2026-11-18', occasion: 'dinner', text: null, cityId: null, wardrobeOnly: true });
    await renderRouter('./src/app', { initialUrl: `/stylist/${jobId}?title=Dinner` });
    await waitFor(() => expect(screen.getByText('SUGGESTION 1 / 3')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByLabelText('Share'));
    expect(share).toHaveBeenCalledTimes(1);
    const message = (share.mock.calls[0]?.[0] as { message: string }).message;
    expect(message).toContain('My outfit idea for Dinner: Gece Laciverti');
    expect(message).toContain('Made with Droblet.');
    share.mockRestore();
  }, 30_000);

  it('17: a missing store piece is marked and "Complete the look" opens the product', async () => {
    const { jobId } = startFixtureStylistOutfit({ requestId: 'missing', date: '2026-11-18', occasion: 'dinner', text: null, cityId: null, wardrobeOnly: false });
    await renderRouter('./src/app', { initialUrl: `/stylist/${jobId}` });
    await waitFor(() => expect(screen.getByText('SUGGESTION 1 / 3')).toBeTruthy(), WAIT);
    expect(screen.getByText('MISSING PIECE')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('complete-look'));
    await waitFor(() => expect(screen.queryByText('SUGGESTION 1 / 3')).toBeNull(), WAIT);
  }, 30_000);
});
