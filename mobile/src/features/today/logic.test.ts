import type { Look } from '@/api/contracts/looks';
import type { EditProduct, PlanDay, WearLog } from '@/api/contracts/today';

import { addDays, monthBounds, monthGrid, monthOf, shiftMonth, weekDates, weekStartOf } from './dates';
import { buildWeekRows, daysToPlan, dayStatus, editSummary, occasionCounts, weekTryOnTargets } from './logic';

const look = (id: string, extra: Partial<Look> = {}): Look => ({
  id,
  name: id,
  occasion: 'office',
  slots: [],
  isFavorite: false,
  rating: null,
  ratingCount: 0,
  tryOnImageUrl: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  baseVersion: 1,
  ...extra,
});
const plan = (date: string, lookId: string | null, occasion: PlanDay['occasion'] = 'office'): PlanDay => ({ date, lookId, occasion, baseVersion: 1 });

describe('dates', () => {
  it('finds the Monday-first week of a date', () => {
    // 18 Nov 2026 is a Wednesday.
    expect(weekStartOf('2026-11-18')).toBe('2026-11-16');
    expect(weekDates('2026-11-18')).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
    // A Sunday belongs to the week that started six days earlier.
    expect(weekStartOf('2026-11-22')).toBe('2026-11-16');
    expect(weekStartOf('2026-11-16')).toBe('2026-11-16');
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('shifts months across years and knows month bounds (leap year included)', () => {
    expect(monthOf('2026-11-18')).toBe('2026-11');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthBounds('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(monthBounds('2028-02').to).toBe('2028-02-29');
  });

  it('builds a Monday-first month grid with blanks', () => {
    // November 2026 starts on a Sunday → six leading blanks, 30 days, six rows.
    const grid = monthGrid('2026-11');
    expect(grid).toHaveLength(6);
    grid.forEach((row) => expect(row).toHaveLength(7));
    expect(grid[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(grid[1]?.[0]).toBe('2026-11-02');
    expect(grid.flat().filter(Boolean)).toHaveLength(30);
    expect(grid[5]).toEqual(['2026-11-30', null, null, null, null, null, null]);
    // February 2027 starts on a Monday and has 28 days → exactly four full rows.
    expect(monthGrid('2027-02')).toHaveLength(4);
  });
});

describe('week plan logic', () => {
  const dates = weekDates('2026-11-18');
  const looks = [look('a'), look('b', { tryOnImageUrl: 'https://x/y.jpg' }), look('c', { occasion: 'weekend' })];
  const rows = buildWeekRows(dates, [plan('2026-11-16', 'a'), plan('2026-11-17', 'b'), plan('2026-11-18', 'gone'), plan('2026-11-19', null, 'dinner'), plan('2026-11-21', 'c', null)], looks);

  it('joins days with their plan and look; an unknown look id reads as no look', () => {
    expect(rows.map((r) => r.look?.id ?? null)).toEqual(['a', 'b', null, null, null, 'c', null]);
    expect(rows[2]?.plan?.lookId).toBe('gone');
  });

  it('counts occasions, most frequent first, falling back to the look occasion', () => {
    expect(occasionCounts(rows)).toEqual([
      { occasion: 'office', count: 3 },
      { occasion: 'dinner', count: 1 },
      { occasion: 'weekend', count: 1 },
    ]);
  });

  it('charges one credit per planned look without an image, skipping days already started', () => {
    expect(weekTryOnTargets(rows)).toEqual([
      { kind: 'plan-day', id: '2026-11-16' },
      { kind: 'plan-day', id: '2026-11-21' },
    ]);
    expect(weekTryOnTargets(rows, ['2026-11-16'])).toEqual([{ kind: 'plan-day', id: '2026-11-21' }]);
  });

  it('plans only today and later days that have no look, keeping their occasion', () => {
    expect(daysToPlan(rows, '2026-11-18')).toEqual([
      { date: '2026-11-18', occasion: 'office' },
      { date: '2026-11-19', occasion: 'dinner' },
      { date: '2026-11-20', occasion: null },
      { date: '2026-11-22', occasion: null },
    ]);
  });
});

describe('editSummary', () => {
  const product = (id: string, price: number, ownedItemId: string | null): EditProduct => ({
    id,
    brand: 'b',
    name: id,
    price,
    imageUrl: null,
    category: 'top',
    ownedItemId,
    inWatchlist: false,
  });
  const products = [product('shirt', 1890, 'item_1'), product('flats', 3300, null), product('bag', 12950, null), product('trousers', 2450, 'item_2')];

  it('hides owned pieces and totals only the missing ones', () => {
    const s = editSummary(products, false);
    expect(s.visible.map((p) => p.id)).toEqual(['flats', 'bag']);
    expect(s.ownedCount).toBe(2);
    expect(s.missingTotal).toBe(16250);
  });

  it('showing owned pieces does not change the total', () => {
    const s = editSummary(products, true);
    expect(s.visible).toHaveLength(4);
    expect(s.missingTotal).toBe(16250);
  });

  it('handles a look the user fully owns', () => {
    const s = editSummary([product('shirt', 1890, 'item_1')], false);
    expect(s).toMatchObject({ visible: [], missing: [], ownedCount: 1, missingTotal: 0 });
  });
});

describe('dayStatus', () => {
  const wearLogs: WearLog[] = [{ id: 'w', date: '2026-11-17', lookId: 'b', itemIds: [], occurredAt: '2026-11-17T07:00:00.000Z' }];
  const month = { wearLogs, planDays: [plan('2026-11-17', 'a'), plan('2026-11-19', 'a'), plan('2026-11-20', null, 'dinner')] };

  it('prefers what was worn over what was planned', () => {
    expect(dayStatus('2026-11-17', month)).toEqual({ kind: 'worn', lookId: 'b' });
  });

  it('reads a planned look, and treats an occasion-only plan as empty', () => {
    expect(dayStatus('2026-11-19', month)).toEqual({ kind: 'planned', lookId: 'a' });
    expect(dayStatus('2026-11-20', month)).toEqual({ kind: 'empty' });
    expect(dayStatus('2026-11-25', month)).toEqual({ kind: 'empty' });
  });
});
