/** yyyy-MM-dd (UTC) — the API's calendar-day format. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function lastDays(n: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - (n - 1) * 86_400_000);
  return { from: isoDay(from), to: isoDay(to) };
}

/** The Monday (UTC) of the week containing `date`. */
export function mondayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return isoDay(d);
}

/** Every day from..to inclusive (fills gaps of a sparse daily series). */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = new Date(`${to}T00:00:00Z`).getTime();
  for (let t = new Date(`${from}T00:00:00Z`).getTime(); t <= end && out.length < 400; t += 86_400_000) out.push(isoDay(new Date(t)));
  return out;
}
