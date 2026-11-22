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

/** ISO (UTC) → the value of an `<input type="datetime-local">` in the browser's time zone. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `<input type="datetime-local">` value (browser time zone) → ISO UTC, or null when empty / invalid. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
