import { fixtureJobOptions, getFixtureJob, resetFixtureJobs, startFixtureJob } from '@/fixtures/jobs';

import { isJobSettled, jobPollInterval } from './jobs';

describe('jobPollInterval', () => {
  it('backs off 1 s → 2 → 4 → 8 and caps at 10 s', () => {
    expect([0, 1, 2, 3, 4, 9].map(jobPollInterval)).toEqual([1000, 2000, 4000, 8000, 10_000, 10_000]);
  });

  it('treats a negative attempt (nothing fetched yet) as the first one', () => {
    expect(jobPollInterval(-1)).toBe(1000);
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
