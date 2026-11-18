/**
 * THE switch between the real API and the typed fixtures.
 *
 * Every query and queued write of the feature modules is written as
 *   fromSource('wardrobe', () => fixture.something(), () => apiRequest<Wire>('v1/tenant/…').then(map))
 * The app runs on the API. Fixtures remain for the unit / screen tests (Jest) and for a dev showcase
 * build started with `EXPO_PUBLIC_DROBLET_FIXTURES=1` (no backend needed).
 *
 * Wire shapes live in `src/api/wire/*`; the app-facing types in `src/api/contracts/*` are what the
 * screens see — the `api` arm of each `fromSource` maps between the two.
 */
export type DataSource = 'fixtures' | 'api';

const USE_FIXTURES = process.env.JEST_WORKER_ID !== undefined || process.env.EXPO_PUBLIC_DROBLET_FIXTURES === '1';

/**
 * Features whose hooks are aligned with the real backend contract. A feature still listed `false`
 * runs on fixtures until its wire types and mappers are written.
 */
const LIVE = {
  /** Hazır parça kütüphanesi (04b, 12b): `GET v1/tenant/library/item`, `POST v1/tenant/item/from-library`. */
  library: true,
  /** Bugün, haftalık plan, takvim (06–09). */
  today: true,
  /** Parçalar, look'lar, bavullar (10–15, 18–19). */
  wardrobe: true,
  /** Stilist önerileri (16–17). */
  stylist: true,
  /** AI job polling, try-on (22) and credits. */
  jobs: true,
  /** Keşfet editorial content (20). */
  content: true,
  /** Stil mağazası catalogue and products (21–23). */
  catalog: true,
  cart: true,
  watchlist: true,
  /** Arkadaş akışı, kişi profili, keşif (25–27). */
  social: true,
  /** Profil, gizlilik ve ayarlar, hesap silme (28–29). */
  account: true,
  /** Renk paleti (30). */
  palette: true,
  /**
   * Bildirim merkezi. The API has no notification inbox yet: against the API the centre is empty (no
   * request is made); fixture builds show the sample list.
   */
  notifications: true,
} satisfies Record<string, boolean>;

export const DATA_SOURCE = Object.fromEntries(
  Object.entries(LIVE).map(([feature, live]) => [feature, live && !USE_FIXTURES ? 'api' : 'fixtures']),
) as Record<keyof typeof LIVE, DataSource>;

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
