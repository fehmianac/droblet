import { calendarWeek } from './WeekStrip';

describe('calendarWeek (06 strip)', () => {
  it('shows Monday → Sunday of the week of today, whatever range the server sent', () => {
    // Thursday 19 November 2026; the server sends today + 6 days.
    const server = [
      { date: '2026-11-19', hasPlan: true },
      { date: '2026-11-20', hasPlan: false },
      { date: '2026-11-21', hasPlan: true },
      { date: '2026-11-22', hasPlan: false },
      { date: '2026-11-23', hasPlan: true },
      { date: '2026-11-24', hasPlan: true },
      { date: '2026-11-25', hasPlan: true },
    ];
    expect(calendarWeek(server, '2026-11-19')).toEqual([
      { date: '2026-11-16', hasPlan: false },
      { date: '2026-11-17', hasPlan: false },
      { date: '2026-11-18', hasPlan: false },
      { date: '2026-11-19', hasPlan: true },
      { date: '2026-11-20', hasPlan: false },
      { date: '2026-11-21', hasPlan: true },
      { date: '2026-11-22', hasPlan: false },
    ]);
  });

  it('starts on the same day when today is a Monday', () => {
    expect(calendarWeek([], '2026-11-16').map((d) => d.date)).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
  });
});
