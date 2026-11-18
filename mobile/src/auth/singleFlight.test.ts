import { singleFlight } from './singleFlight';

describe('singleFlight', () => {
  it('shares one in-flight promise between concurrent callers (no refresh race)', async () => {
    let calls = 0;
    let release: (v: string) => void = () => undefined;
    const refresh = singleFlight(() => {
      calls += 1;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    });

    const a = refresh();
    const b = refresh();
    release('token-1');
    await expect(Promise.all([a, b])).resolves.toEqual(['token-1', 'token-1']);
    expect(calls).toBe(1);
  });

  it('starts a new call after the previous one settled', async () => {
    let calls = 0;
    const refresh = singleFlight(async () => {
      calls += 1;
      return calls;
    });
    await refresh();
    await refresh();
    expect(calls).toBe(2);
  });

  it('lets the next caller retry after a failure', async () => {
    let calls = 0;
    const refresh = singleFlight(async () => {
      calls += 1;
      if (calls === 1) throw new Error('offline');
      return 'ok';
    });
    await expect(refresh()).rejects.toThrow('offline');
    await expect(refresh()).resolves.toBe('ok');
  });
});
