import i18n from '@/i18n';

import { formatMoney, formatNumber, formatPercent, sumMoney } from './intl';

describe('locale-aware formatting', () => {
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
    expect(formatNumber(4.7, 1)).toBe('4,7');
    await i18n.changeLanguage('en');
    expect(formatPercent(64)).toBe('64%');
    expect(formatNumber(4.7, 1)).toBe('4.7');
  });

  it('sums one currency and ignores missing prices', () => {
    expect(sumMoney([{ amountMinor: 100, currency: 'TRY' }, null, { amountMinor: 250, currency: 'TRY' }])).toEqual({
      amountMinor: 350,
      currency: 'TRY',
    });
    expect(sumMoney([null])).toBeNull();
  });
});
