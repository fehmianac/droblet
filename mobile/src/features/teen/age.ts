import type { AgeBand, TeenConfig } from '@/api/contracts/teen';

/**
 * Birth year → what sign-up does next (canvas 18 · 02 / 02f). The server decides the band (docs/api/teen.md §3); the
 * app only routes: under 16 never sends anything, a teen sees 02h first, an ambiguous year also asks the month.
 *
 * Months count conservatively like the server: with a month, the birthday counts as reached from the first day of the
 * next month. Without a month a year that can mean either side of 16 or 18 is "ambiguous".
 */
export type AgeOutcome = 'underage' | 'teen' | 'adult' | 'needsMonth' | 'teenClosed';

/**
 * The selectable years, newest first: from 10 years ago (so a younger child can still answer and get the kind 02g
 * refusal instead of being unable to pick) back to 100 years ago.
 */
export function birthYears(now: Date = new Date()): number[] {
  const newest = now.getFullYear() - 10;
  return Array.from({ length: 91 }, (_, i) => newest - i);
}

/** Completed years at `now`; with a month, the birthday is reached on the 1st of the following month. */
function ageAt(year: number, month: number | null, now: Date): number | null {
  const y = now.getFullYear();
  if (month === null) return null;
  // Birthday reached when today is on or after the 1st of (month + 1) of this year.
  const reached = now.getMonth() + 1 > month;
  return y - year - (reached ? 0 : 1);
}

export function ageOutcome(
  year: number,
  month: number | null,
  config: Pick<TeenConfig, 'enabled' | 'minimumAge' | 'adultAge'>,
  now: Date = new Date(),
): AgeOutcome {
  const byYear = now.getFullYear() - year;
  const exact = ageAt(year, month, now);
  // Without a month: at most `byYear`, at least `byYear - 1`.
  const max = exact ?? byYear;
  const min = exact ?? byYear - 1;
  if (max < config.minimumAge) return 'underage';
  if (min >= config.adultAge) return 'adult';
  if (exact === null && (min < config.minimumAge || max >= config.adultAge)) return 'needsMonth';
  return config.enabled ? 'teen' : 'teenClosed';
}

export function bandOf(outcome: AgeOutcome): AgeBand | null {
  return outcome === 'teen' ? 'teen' : outcome === 'adult' ? 'adult' : null;
}
