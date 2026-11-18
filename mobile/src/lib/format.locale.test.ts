import i18n from '@/i18n';

import {
  formatDate,
  formatDateRange,
  formatDayMonth,
  formatIsoDateRange,
  formatMoney,
  formatMonthYear,
  formatNumber,
  formatPercent,
  formatTemperature,
  formatYearMonth,
  moneyFromMajor,
  relativeTime,
  sumMoney,
  weekdayShort,
} from './format';
import { toDisplayUpper } from './upper';

const date = new Date(2026, 10, 18); // Wednesday 18 November 2026

describe('formatting follows the active app language', () => {
  afterAll(async () => {
    await i18n.changeLanguage('tr');
  });

  it('Turkish', async () => {
    await i18n.changeLanguage('tr');
    expect(formatMoney(moneyFromMajor(26550, 'TRY'))).toBe('₺26.550');
    expect(formatNumber(4.6, { maximumFractionDigits: 1 })).toBe('4,6');
    expect(formatTemperature(14.4)).toBe('14°');
    expect(formatMonthYear(date)).toBe('Kasım 2026');
    expect(formatDate(date, { day: 'numeric', month: 'short' })).toBe('18 Kas');
    expect(weekdayShort(date)).toBe('Çar');
    expect(formatDateRange(new Date(2026, 11, 12), new Date(2026, 11, 16))).toMatch(/12.*16 Ara/);
  });

  it('English', async () => {
    await i18n.changeLanguage('en');
    expect(formatMoney(moneyFromMajor(26550, 'TRY'))).toBe('₺26,550');
    expect(formatNumber(4.6, { maximumFractionDigits: 1 })).toBe('4.6');
    expect(formatTemperature(14.4)).toBe('14°');
    expect(formatMonthYear(date)).toBe('November 2026');
    expect(formatDate(date, { day: 'numeric', month: 'short' })).toBe('18 Nov');
    expect(weekdayShort(date)).toBe('Wed');
  });

  it('upper-cases dynamic text for any language code', () => {
    expect(toDisplayUpper('istanbul', 'tr')).toBe('İSTANBUL');
    expect(toDisplayUpper('istanbul', 'en')).toBe('ISTANBUL');
    expect(toDisplayUpper('istanbul', 'de')).toBe('ISTANBUL');
  });
});
describe('money, percent and numbers', () => {
  afterAll(() => i18n.changeLanguage('tr'));

  it('formats money from minor units with the active language', async () => {
    await i18n.changeLanguage('tr');
    expect(formatMoney({ amountMinor: 300000, currency: 'TRY' })).toBe('₺3.000');
    expect(formatMoney({ amountMinor: 19999, currency: 'TRY' })).toBe('₺199,99');
    await i18n.changeLanguage('en');
    expect(formatMoney({ amountMinor: 300000, currency: 'TRY' })).toMatch(/3,000/);
    expect(formatMoney({ amountMinor: 1250, currency: 'EUR' })).toBe('€12.50');
  });

  it('respects currencies without minor units', async () => {
    await i18n.changeLanguage('en');
    expect(formatMoney({ amountMinor: 500, currency: 'JPY' })).toMatch(/500/);
  });

  it('formats percentages and numbers per language', async () => {
    await i18n.changeLanguage('tr');
    expect(formatPercent(64)).toBe('%64');
    expect(formatNumber(4.7, { maximumFractionDigits: 1 })).toBe('4,7');
    await i18n.changeLanguage('en');
    expect(formatPercent(64)).toBe('64%');
    expect(formatNumber(4.7, { maximumFractionDigits: 1 })).toBe('4.7');
  });

  it('sums one currency and ignores missing prices', () => {
    expect(sumMoney([{ amountMinor: 100, currency: 'TRY' }, null, { amountMinor: 250, currency: 'TRY' }])).toEqual({
      amountMinor: 350,
      currency: 'TRY',
    });
    expect(sumMoney([null])).toBeNull();
  });
});

describe('dates from wire values', () => {
  afterAll(() => i18n.changeLanguage('tr'));

  it('formats ISO ranges, months and days in the active language', async () => {
    await i18n.changeLanguage('tr');
    expect(formatIsoDateRange('2026-11-09', '2026-11-15')).toBe('9–15 Kasım');
    expect(formatIsoDateRange('2026-11-28', '2026-12-04')).toBe('28 Kasım – 4 Aralık');
    expect(formatYearMonth('2026-11')).toBe('Kasım 2026');
    expect(formatDayMonth(new Date(2026, 11, 1))).toBe('1 Aralık');
    await i18n.changeLanguage('en');
    expect(formatIsoDateRange('2026-11-09', '2026-11-15')).toBe('9–15 November');
    expect(formatYearMonth('2026-11')).toBe('November 2026');
  });

  it('buckets relative time', () => {
    const now = new Date('2026-11-18T12:00:00Z');
    expect(relativeTime('2026-11-18T11:59:40Z', now)).toEqual({ unit: 'now' });
    expect(relativeTime('2026-11-18T11:15:00Z', now)).toEqual({ unit: 'minutes', count: 45 });
    expect(relativeTime('2026-11-18T09:00:00Z', now)).toEqual({ unit: 'hours', count: 3 });
    expect(relativeTime('2026-11-15T12:00:00Z', now)).toEqual({ unit: 'days', count: 3 });
  });
});
