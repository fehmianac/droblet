/**
 * THE switch between typed fixtures and the real API for the feature slices whose backend is
 * still being written (Bugün, Gardırop, Stilist, AI jobs).
 *
 * Every hook / queued mutation function is written as
 *   fromSource('wardrobe', () => fixture.something(), () => apiRequest<T>('v1/tenant/…'))
 * so going live is one line: set the feature below to 'api' (or, per hook, drop the fixture argument).
 */
export type DataSource = 'fixtures' | 'api';

export const DATA_SOURCE: Record<'today' | 'wardrobe' | 'stylist' | 'jobs', DataSource> = {
  today: 'fixtures',
  wardrobe: 'fixtures',
  stylist: 'fixtures',
  jobs: 'fixtures',
};

export type SourceFeature = keyof typeof DATA_SOURCE;

/** Simulated latency so loading skeletons are exercised in development. */
export const FIXTURE_LATENCY_MS = 350;

export function fromSource<T>(feature: SourceFeature, fixture: () => T | Promise<T>, api: () => Promise<T>): Promise<T> {
  if (DATA_SOURCE[feature] === 'api') return api();
  return new Promise<T>((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(fixture());
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    }, FIXTURE_LATENCY_MS);
  });
}
