import i18n from '@/i18n';

import { formatDate, formatDateRange, formatMonthYear, formatNumber, formatTemperature, formatTry, weekdayShort } from './format';
import { toDisplayUpper } from './upper';

const date = new Date(2026, 10, 18); // Wednesday 18 November 2026

describe('formatting follows the active app language', () => {
  afterAll(async () => {
    await i18n.changeLanguage('tr');
  });

  it('Turkish', async () => {
    await i18n.changeLanguage('tr');
    expect(formatTry(26550)).toBe('₺26.550');
    expect(formatNumber(4.6, { maximumFractionDigits: 1 })).toBe('4,6');
    expect(formatTemperature(14.4)).toBe('14°');
    expect(formatMonthYear(date)).toBe('Kasım 2026');
    expect(formatDate(date, { day: 'numeric', month: 'short' })).toBe('18 Kas');
    expect(weekdayShort(date)).toBe('Çar');
    expect(formatDateRange(new Date(2026, 11, 12), new Date(2026, 11, 16))).toMatch(/12.*16 Ara/);
  });

  it('English', async () => {
    await i18n.changeLanguage('en');
    expect(formatTry(26550)).toBe('₺26,550');
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
