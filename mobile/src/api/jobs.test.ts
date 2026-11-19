import { fixtureJobOptions, getFixtureJob, resetFixtureJobs, startFixtureJob } from '@/fixtures/jobs';

import { isJobSettled, jobPollInterval } from './jobs';

describe('jobPollInterval', () => {
  it('polls every 750 ms for the first 3 s, then every 1.5 s, and every 3 s after 15 s', () => {
    expect([0, 2999, 3000, 14_999, 15_000, 120_000].map((t) => jobPollInterval(t))).toEqual([750, 750, 1500, 1500, 3000, 3000]);
  });

  it('treats a negative elapsed time (clock skew) as the start', () => {
    expect(jobPollInterval(-500)).toBe(750);
  });

  it('follows the server hint, clamped to 500 ms … 3 s', () => {
    expect(jobPollInterval(20_000, 1800)).toBe(1800);
    expect(jobPollInterval(0, 120)).toBe(500);
    expect(jobPollInterval(0, 18_000)).toBe(3000);
    expect(jobPollInterval(5000, null)).toBe(1500);
    expect(jobPollInterval(5000, 0)).toBe(1500);
    expect(jobPollInterval(5000, Number.NaN)).toBe(1500);
  });

  it('notices a 26 s job within 3 s instead of at 35 s', () => {
    const noticedAt = (completedMs: number, next: (elapsed: number) => number) => {
      let t = 0;
      while (t < completedMs) t += next(t);
      return t;
    };
    const oldBackOff = (() => {
      let attempt = 0;
      return () => Math.min(1000 * 2 ** attempt++, 10_000);
    })();
    expect(noticedAt(26_000, oldBackOff)).toBe(35_000);
    expect(noticedAt(26_000, (t) => jobPollInterval(t)) - 26_000).toBeLessThanOrEqual(3000);
  });
});

describe('isJobSettled', () => {
  it('is true only for done / failed', () => {
    expect(isJobSettled(undefined)).toBe(false);
    expect(isJobSettled({ status: 'queued' })).toBe(false);
    expect(isJobSettled({ status: 'running' })).toBe(false);
    expect(isJobSettled({ status: 'done' })).toBe(true);
    expect(isJobSettled({ status: 'failed' })).toBe(true);
  });
});

describe('fixture jobs', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetFixtureJobs();
  });
  afterEach(() => jest.useRealTimers());

  it('runs, then delivers the result once the duration has passed', () => {
    const id = startFixtureJob('tryon', () => ({ imageUrl: 'x' }), { durationMs: 3000 });
    expect(getFixtureJob(id, 'tryon').status).toBe('queued');
    jest.advanceTimersByTime(1000);
    expect(getFixtureJob(id, 'tryon').status).toBe('running');
    jest.advanceTimersByTime(2500);
    expect(getFixtureJob(id, 'tryon')).toMatchObject({ status: 'done', result: { imageUrl: 'x' }, error: null });
  });

  it('is idempotent on the request id', () => {
    const make = jest.fn(() => 1);
    const a = startFixtureJob('stylist-outfit', make, { id: 'req-1', durationMs: 10 });
    const b = startFixtureJob('stylist-outfit', make, { id: 'req-1', durationMs: 10 });
    expect(a).toBe(b);
    jest.advanceTimersByTime(20);
    getFixtureJob(a, 'stylist-outfit');
    getFixtureJob(a, 'stylist-outfit');
    expect(make).toHaveBeenCalledTimes(1);
  });

  it('fails with a refunded credit when asked to, and only for the next job', () => {
    fixtureJobOptions.failNext = { code: 'generation_failed', creditRefunded: true };
    const failing = startFixtureJob('tryon', () => 1, { id: 'a', durationMs: 10 });
    const fine = startFixtureJob('tryon', () => 1, { id: 'b', durationMs: 10 });
    jest.advanceTimersByTime(20);
    expect(getFixtureJob(failing, 'tryon')).toMatchObject({ status: 'failed', error: { code: 'generation_failed', creditRefunded: true } });
    expect(getFixtureJob(fine, 'tryon').status).toBe('done');
  });

  it('reads an unknown job (e.g. after a restart) as failed', () => {
    expect(getFixtureJob('nope', 'tryon')).toMatchObject({ status: 'failed', error: { code: 'job_not_found' } });
  });
});
