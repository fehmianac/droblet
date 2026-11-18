/**
 * Reminder times are the user's LOCAL wall-clock time on the wire (`morningOutfitLocalTime`, `HH:mm`,
 * quarter hours) together with the device's IANA time zone (`deviceTimeZone`) — the server does the
 * DST-safe conversion. The UTC helpers below remain for local scheduling maths only.
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

/** The device's IANA time zone id (`Europe/Istanbul`), sent with notification preferences and device registration. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Istanbul';
  } catch {
    return 'Europe/Istanbul';
  }
}

/** Nearest quarter hour of an `HH:mm` value — the only minutes the API accepts. */
export function toQuarterHour(time: string): string {
  const t = parse(time);
  if (!t) return time;
  const total = (Math.round((t.hours * 60 + t.minutes) / 15) * 15) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}
