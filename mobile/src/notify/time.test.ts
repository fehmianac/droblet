import { localToUtcTime, REMINDER_TIMES, utcToLocalTime } from './time';

describe('reminder time conversion', () => {
  const on = new Date(2026, 10, 18, 12, 0);

  it('round-trips local ↔ UTC', () => {
    REMINDER_TIMES.forEach((local) => expect(utcToLocalTime(localToUtcTime(local, on), on)).toBe(local));
  });

  it('applies the device offset', () => {
    const offsetMinutes = -on.getTimezoneOffset();
    const total = (((7 * 60 + 30 - offsetMinutes) % 1440) + 1440) % 1440;
    const expected = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    expect(localToUtcTime('07:30', on)).toBe(expected);
  });

  it('leaves malformed values alone and offers half-hour steps', () => {
    expect(utcToLocalTime('25:99', on)).toBe('25:99');
    expect(REMINDER_TIMES[0]).toBe('05:30');
    expect(REMINDER_TIMES[REMINDER_TIMES.length - 1]).toBe('11:00');
  });
});
