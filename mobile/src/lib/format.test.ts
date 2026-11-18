import { formatMoney, moneyFromMajor, parseLocalDate, seasonOf, toIsoDate } from './format';

jest.mock('@/i18n', () => ({ currentLocaleTag: () => 'tr-TR' }));

describe('format', () => {
  it('formats TRY with tr-TR grouping', () => {
    expect(formatMoney(moneyFromMajor(26550, 'TRY'))).toBe('₺26.550');
    expect(formatMoney(moneyFromMajor(199.99, 'TRY'))).toBe('₺199,99');
  });

  it('round-trips local calendar dates', () => {
    expect(toIsoDate(parseLocalDate('2026-11-18'))).toBe('2026-11-18');
  });

  it('derives the season', () => {
    expect(seasonOf(parseLocalDate('2026-11-18'))).toBe('autumn');
    expect(seasonOf(parseLocalDate('2026-01-10'))).toBe('winter');
  });
});
