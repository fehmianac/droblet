import { withLatency } from '@/fixtures/today';

/**
 * THE switch between typed fixtures and the real API for the epics whose backend is still being
 * written (E7 palet · E8 keşfet/mağaza/sepet · E9 sosyal · E11 gizlilik).
 *
 * Every query and queued write of those features goes through `fromSource(feature, fixture, api)`,
 * so moving a feature to the backend is one word here — or, to move a single hook earlier, replace
 * its `fromSource(...)` call with its `api` argument (one line).
 *
 * The request/response shapes are the provisional contracts in `src/api/contracts/*`.
 */
export type DataFeature =
  | 'content'
  | 'catalog'
  | 'cart'
  | 'watchlist'
  | 'social'
  | 'account'
  | 'palette'
  | 'tryOn'
  | 'wardrobe';

type Source = 'fixture' | 'api';

export const DATA_SOURCE: Record<DataFeature, Source> = {
  content: 'fixture',
  catalog: 'fixture',
  cart: 'fixture',
  watchlist: 'fixture',
  social: 'fixture',
  account: 'fixture',
  palette: 'fixture',
  tryOn: 'fixture',
  wardrobe: 'fixture',
};

/** Simulated latency so skeletons and optimistic updates are exercised in development. */
const FIXTURE_LATENCY_MS = 250;

export function fromSource<T>(feature: DataFeature, fixture: () => T, api: () => Promise<T>): Promise<T> {
  if (DATA_SOURCE[feature] === 'api') return api();
  // Fixtures run after the delay, so a thrown fixture error rejects like a failed request would.
  return withLatency(undefined, FIXTURE_LATENCY_MS).then(fixture);
}

/** `?a=1&b=x` from defined, non-empty values (arrays are comma-joined). */
export function queryString(params: Record<string, string | number | string[] | null | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    const text = Array.isArray(value) ? value.join(',') : String(value);
    if (text === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(text)}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}
