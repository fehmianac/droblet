import { currentLocaleTag } from '@/i18n';

/**
 * Locale-aware formatting for everything numeric the user reads — money, percentages, plain
 * numbers — always through `Intl` with the active app language. Never concatenate "₺" or "%" by hand:
 * Turkish writes "%64" and "₺3.000", English "64%" and "TRY 3,000".
 * Dates live in `./dates` and use the same locale.
 */

/** Money as the API sends it: an integer amount in the currency's minor unit + ISO 4217 code. */
export type Money = { amountMinor: number; currency: string };

const fractionDigitsCache = new Map<string, number>();

/** Minor-unit exponent of a currency (TRY 2, JPY 0, KWD 3), from the platform's currency data. */
function minorUnitDigits(currency: string): number {
  const cached = fractionDigitsCache.get(currency);
  if (cached !== undefined) return cached;
  let digits = 2;
  try {
    digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    // Unknown code: assume two decimals.
  }
  fractionDigitsCache.set(currency, digits);
  return digits;
}

/** "₺3.000" / "₺199,99" (tr) — whole amounts are shown without decimals. */
export function formatMoney(money: Money): string {
  const digits = minorUnitDigits(money.currency);
  const amount = money.amountMinor / 10 ** digits;
  const whole = Number.isInteger(amount);
  try {
    return new Intl.NumberFormat(currentLocaleTag(), {
      style: 'currency',
      currency: money.currency,
      minimumFractionDigits: whole ? 0 : digits,
      maximumFractionDigits: whole ? 0 : digits,
    }).format(amount);
  } catch {
    return `${formatNumber(amount, whole ? 0 : digits)} ${money.currency}`;
  }
}

/** Adds amounts of one currency (a cart or an outfit is priced in a single currency). Null when empty. */
export function sumMoney(values: (Money | null)[]): Money | null {
  const priced = values.filter((v): v is Money => v !== null);
  const first = priced[0];
  if (!first) return null;
  return {
    currency: first.currency,
    amountMinor: priced.filter((v) => v.currency === first.currency).reduce((sum, v) => sum + v.amountMinor, 0),
  };
}

/** "%64" (tr) / "64%" (en) from a 0–100 value. */
export function formatPercent(value: number): string {
  return new Intl.NumberFormat(currentLocaleTag(), { style: 'percent', maximumFractionDigits: 0 }).format(value / 100);
}

/** "4,7" (tr) / "4.7" (en). */
export function formatNumber(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat(currentLocaleTag(), { maximumFractionDigits }).format(value);
}
