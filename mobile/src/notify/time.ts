/**
 * Reminder times are shown in the device's local time and travel as UTC `HH:mm`
 * (MOBILE_ENGINEER §Push bildirimleri). The offset is taken for `on` (today by default), so the
 * conversion follows daylight-saving changes where they exist.
 */
const pad = (n: number) => String(n).padStart(2, '0');

function parse(time: string): { hours: number; minutes: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return match ? { hours: Number(match[1]), minutes: Number(match[2]) } : null;
}

export function utcToLocalTime(utc: string, on: Date = new Date()): string {
  const t = parse(utc);
  if (!t) return utc;
  const d = new Date(Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate(), t.hours, t.minutes));
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localToUtcTime(local: string, on: Date = new Date()): string {
  const t = parse(local);
  if (!t) return local;
  const d = new Date(on.getFullYear(), on.getMonth(), on.getDate(), t.hours, t.minutes);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Local reminder times offered in 29: 05:30 – 11:00 in half-hour steps. */
export const REMINDER_TIMES: string[] = Array.from({ length: 12 }, (_, i) => {
  const total = 5 * 60 + 30 + i * 30;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
});
