/**
 * THE switch between typed fixtures and the real API for every feature whose backend is still being
 * written.
 *
 * Every query and queued write of those features is written as
 *   fromSource('wardrobe', () => fixture.something(), () => apiRequest<T>('v1/tenant/…'))
 * so moving a feature to the backend is one word here — or, to move a single hook earlier, replace
 * its `fromSource(...)` call with its `api` argument (one line).
 *
 * The request/response shapes are the provisional contracts in `src/api/contracts/*`.
 */
export type DataSource = 'fixtures' | 'api';

export const DATA_SOURCE = {
  /** Bugün, haftalık plan, takvim (06–09). */
  today: 'fixtures',
  /** Parçalar, look'lar, bavullar (10–15, 18–19). */
  wardrobe: 'fixtures',
  /** Stilist önerileri (16–17). */
  stylist: 'fixtures',
  /** AI job polling, try-on (22) and credits. */
  jobs: 'fixtures',
  /** Keşfet editorial content (20). */
  content: 'fixtures',
  /** Stil mağazası catalogue and products (21–23). */
  catalog: 'fixtures',
  cart: 'fixtures',
  watchlist: 'fixtures',
  /** Arkadaş akışı, kişi profili, keşif (25–27). */
  social: 'fixtures',
  /** Profil, gizlilik ve ayarlar, hesap silme (28–29). */
  account: 'fixtures',
  /** Renk paleti (30). */
  palette: 'fixtures',
  /** Bildirim merkezi (provisional contract). */
  notifications: 'fixtures',
} satisfies Record<string, DataSource> as Record<
  'today' | 'wardrobe' | 'stylist' | 'jobs' | 'content' | 'catalog' | 'cart' | 'watchlist' | 'social' | 'account' | 'palette' | 'notifications',
  DataSource
>;

export type DataFeature = keyof typeof DATA_SOURCE;

/** Simulated latency so loading skeletons and optimistic updates are exercised in development. */
export const FIXTURE_LATENCY_MS = 350;

export function fromSource<T>(feature: DataFeature, fixture: () => T | Promise<T>, api: () => Promise<T>): Promise<T> {
  if (DATA_SOURCE[feature] === 'api') return api();
  // Fixtures run after the delay, so a thrown fixture error rejects like a failed request would.
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
