import type { StylistOutfitRequest } from '@/api/contracts/stylist';
import { fixtureDb, resetFixtureDb } from '@/fixtures/db';
import { getFixtureJob, resetFixtureJobs } from '@/fixtures/jobs';
import { acceptFixtureSuggestion, buildFixtureSuggestions, startFixtureStylistOutfit } from '@/fixtures/stylist';
import { isTryOnTargetKind } from '@/features/tryon/api';

import { dateParamOrToday, toStylistRequest, validateStylistDraft, type StylistDraft } from './api';
import { calendarOptions, defaultCalendarDate } from './SuggestionSheets';

const draft = (over: Partial<StylistDraft> = {}): StylistDraft => ({
  date: '2026-11-18',
  occasion: null,
  text: '',
  wardrobeOnly: true,
  itemIds: [],
  ...over,
});

beforeEach(() => {
  resetFixtureDb();
  resetFixtureJobs();
});

describe('validateStylistDraft', () => {
  it('needs an occasion or a few words', () => {
    expect(validateStylistDraft(draft())).toBe('needs_input');
    expect(validateStylistDraft(draft({ text: '  ab ' }))).toBe('text_too_short');
    expect(validateStylistDraft(draft({ text: 'akşam iş yemeği' }))).toBeNull();
    expect(validateStylistDraft(draft({ occasion: 'dinner' }))).toBeNull();
    expect(validateStylistDraft(draft({ occasion: 'dinner', text: 'ab' }))).toBeNull();
  });

  it('rejects over-long text and malformed dates', () => {
    expect(validateStylistDraft(draft({ text: 'x'.repeat(141) }))).toBe('text_too_long');
    expect(validateStylistDraft(draft({ occasion: 'office', date: '18.11.2026' }))).toBe('bad_date');
  });
});

describe('toStylistRequest', () => {
  it('trims text, nulls empty text and only sends pinned pieces when there are any', () => {
    const plain = toStylistRequest(draft({ occasion: 'office', text: '   ' }), 'req1');
    expect(plain).toEqual({ requestId: 'req1', date: '2026-11-18', occasion: 'office', text: null, cityId: null, wardrobeOnly: true });
    const pinned = toStylistRequest(draft({ text: ' yağmurlu ', itemIds: ['item_navy_blazer'] }), 'req2');
    expect(pinned.text).toBe('yağmurlu');
    expect(pinned.itemIds).toEqual(['item_navy_blazer']);
  });
});

describe('route params', () => {
  it('falls back to today for a missing or malformed date', () => {
    const today = new Date(2026, 10, 18);
    expect(dateParamOrToday(undefined, today)).toBe('2026-11-18');
    expect(dateParamOrToday('tomorrow', today)).toBe('2026-11-18');
    expect(dateParamOrToday('2026-11-20', today)).toBe('2026-11-20');
  });

  it('narrows try-on target kinds', () => {
    expect(isTryOnTargetKind('suggestion')).toBe(true);
    expect(isTryOnTargetKind('nope')).toBe(false);
    expect(isTryOnTargetKind(undefined)).toBe(false);
  });
});

describe('calendar sheet days', () => {
  const today = new Date(2026, 10, 18);
  it('offers today + six days, plus a requested day further ahead', () => {
    expect(calendarOptions('2026-11-18', today)).toHaveLength(7);
    expect(calendarOptions('2026-11-18', today)[0]).toBe('2026-11-18');
    expect(calendarOptions('2026-12-05', today).at(-1)).toBe('2026-12-05');
  });
  it('preselects the requested day unless it is past', () => {
    expect(defaultCalendarDate('2026-11-20', today)).toBe('2026-11-20');
    expect(defaultCalendarDate('2026-11-01', today)).toBe('2026-11-18');
  });
});

describe('fixture suggestions', () => {
  it('builds three different suggestions, each with at least two pieces', () => {
    const suggestions = buildFixtureSuggestions({ wardrobeOnly: true }, fixtureDb.items);
    expect(suggestions.map((s) => s.index)).toEqual([0, 1, 2]);
    suggestions.forEach((s) => expect(s.pieces.length).toBeGreaterThanOrEqual(2));
    expect(new Set(suggestions.map((s) => s.pieces.map((p) => p.refId).join())).size).toBe(3);
  });

  it('wardrobe-only never proposes store pieces; otherwise exactly one missing piece is suggested', () => {
    const only = buildFixtureSuggestions({ wardrobeOnly: true }, fixtureDb.items);
    expect(only.flatMap((s) => s.pieces).every((p) => p.source === 'wardrobe')).toBe(true);
    const open = buildFixtureSuggestions({ wardrobeOnly: false }, fixtureDb.items);
    const store = open.flatMap((s) => s.pieces).filter((p) => p.source === 'store');
    expect(store).toHaveLength(1);
    expect(store[0]?.price).not.toBeNull();
  });

  it('puts a pinned piece into every suggestion, once per slot', () => {
    const suggestions = buildFixtureSuggestions({ wardrobeOnly: true, itemIds: ['item_tweed_jacket'] }, fixtureDb.items);
    for (const s of suggestions) {
      expect(s.pieces.some((p) => p.refId === 'item_tweed_jacket')).toBe(true);
      expect(new Set(s.pieces.map((p) => p.slot)).size).toBe(s.pieces.length);
    }
  });

  it('a pinned bottom is never combined with a dress on top', () => {
    const suggestions = buildFixtureSuggestions({ wardrobeOnly: true, itemIds: ['item_straight_jeans'] }, fixtureDb.items);
    for (const s of suggestions) {
      expect(s.pieces.some((p) => p.refId === 'item_straight_jeans')).toBe(true);
      expect(s.pieces.some((p) => p.category === 'dress')).toBe(false);
    }
  });

  it('copes with an empty wardrobe', () => {
    expect(buildFixtureSuggestions({ wardrobeOnly: true }, [])).toHaveLength(3);
  });
});

describe('accepting a suggestion (fixture server)', () => {
  const request: StylistOutfitRequest = { requestId: 'r1', date: '2026-11-20', occasion: 'dinner', text: null, cityId: null, wardrobeOnly: false };
  const meta = { clientMutationId: 'c1', occurredAt: '2026-11-18T08:00:00.000Z' };

  function finishedJob(): string {
    jest.useFakeTimers();
    const { jobId } = startFixtureStylistOutfit(request);
    jest.advanceTimersByTime(10_000);
    expect(getFixtureJob(jobId, 'stylist-outfit').status).toBe('done');
    return jobId;
  }
  afterEach(() => jest.useRealTimers());

  it('writes a look, and a plan day only when a date is given', () => {
    const jobId = finishedJob();
    const before = fixtureDb.looks.length;
    expect(acceptFixtureSuggestion(jobId, 1, { lookId: 'look_new', date: null, ...meta })).toEqual({ lookId: 'look_new', plannedDate: null });
    expect(fixtureDb.looks).toHaveLength(before + 1);
    expect(fixtureDb.planDays.some((d) => d.lookId === 'look_new')).toBe(false);

    acceptFixtureSuggestion(jobId, 1, { lookId: 'look_other', date: '2026-11-20', ...meta });
    // Already saved: the same look is planned, no duplicate.
    expect(fixtureDb.looks).toHaveLength(before + 1);
    expect(fixtureDb.planDays.filter((d) => d.date === '2026-11-20')).toMatchObject([{ occasion: 'dinner', lookId: 'look_new' }]);
  });

  it('keeps the missing store piece as a store slot', () => {
    const jobId = finishedJob();
    acceptFixtureSuggestion(jobId, 0, { lookId: 'look_store', date: null, ...meta });
    const look = fixtureDb.looks.find((l) => l.id === 'look_store');
    expect(look?.slots.filter((s) => s.source === 'store')).toHaveLength(1);
  });

  it('rejects an unknown suggestion', () => {
    const jobId = finishedJob();
    expect(() => acceptFixtureSuggestion(jobId, 9, { lookId: 'x', date: null, ...meta })).toThrow();
  });
});
