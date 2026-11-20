import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type { StartTryOnRequest, StartTryOnResponse, TryOnResult, TryOnTarget, TryOnTargetKind } from '@/api/contracts/tryon';
import { ApiError } from '@/api/errors';
import { useJob, type JobView } from '@/api/jobs';
import { fromSource } from '@/api/dataSource';
import {
  cachedTryOnImageId,
  cachedTryOnJobId,
  mapTryOnResult,
  requestExistingTryOn,
  requestTryOnImage,
  toWeekJobs,
  toWeekQuote,
  toWireTarget,
  CREDIT_QUOTE_CHANGED,
  type TryOnStartWire,
  type TryOnWeekQuote,
  type TryOnWeekQuoteWire,
  type TryOnWeekStartWire,
} from '@/api/wire/tryon';
import type { MyPhotos } from '@/api/contracts/account';
import { CONSENTS_FOR, type ConsentType } from '@/api/contracts/consents';
import { accountKeys } from '@/features/account/queries';
import { getActiveQueryClient } from '@/sync/activeClient';
import { ensureConsents } from '@/features/consent/store';
import { routeAiStartError } from '@/features/credits/aiErrors';
import { aiCreditsKey } from '@/features/credits/useAiCredits';
import { fixtureDb } from '@/fixtures/db';
import { fixtureJobOptions, startFixtureJob } from '@/fixtures/jobs';
import { ulid } from '@/lib/ids';
import { trackTryOnStarted, type TryOnPath } from '@/analytics/jobEvents';

import { matchesPhotoKey, useTryOnPhotoKey, type TryOnPhotoKey } from './photoKey';
import { tryOnRuns } from './runs';

/** Every try-on image costs one credit (README §9.1). Shown before starting; the server is authoritative. */
export const TRY_ON_CREDIT_COST = 1;

const TARGET_KINDS: readonly TryOnTargetKind[] = ['item', 'look', 'product', 'edit-look', 'suggestion', 'plan-day', 'trip-day'];

/** Narrows a route param to a try-on target kind (the try-on screen takes `kind` + `id` so it can retry). */
export function isTryOnTargetKind(value: string | undefined): value is TryOnTargetKind {
  return Boolean(value) && (TARGET_KINDS as readonly string[]).includes(value ?? '');
}

function startFixtureTryOn(request: StartTryOnRequest): StartTryOnResponse {
  const credits = fixtureDb.entitlement.credits;
  if (credits.remaining < TRY_ON_CREDIT_COST) {
    throw new ApiError('http', 409, { code: 'monthly_limit_reached' });
  }
  // As the server: a look the server does not hold yet (its write still queued) is not a target.
  if (request.target.kind === 'look' && !fixtureDb.looks.some((l) => l.id === request.target.id)) {
    throw new ApiError('http', 404, { code: 'target_not_found' });
  }
  // The server reserves the credit at start and returns it if the job fails.
  if (!fixtureJobOptions.failNext) credits.remaining -= TRY_ON_CREDIT_COST;
  const jobId = startFixtureJob<TryOnResult>(
    'tryon',
    () => ({
      tryOnId: `tryon_${request.requestId}`,
      target: request.target,
      imageUrl: fixtureJobOptions.tryOnImageUrl,
      creditsRemaining: fixtureDb.entitlement.credits.remaining,
    }),
    { id: `job_${request.requestId}` },
  );
  return { jobId };
}

/**
 * The consents of the photo path the server will use: the full-length photo when there is one (consents 1 + 6),
 * else the face photo + body type (consents 7 + 6, `facePhotoTryOn`). Read from the cached photos.
 */
export function tryOnConsents(): readonly ConsentType[] {
  const photos = getActiveQueryClient()?.getQueryData<MyPhotos>(accountKeys.photos);
  if (photos && photos.body.length === 0 && photos.face) return CONSENTS_FOR.tryOnFace;
  return CONSENTS_FOR.tryOn;
}

/** Which picture a try-on is rendered on (analytics `path`): the full-length photo when there is one, else the face. */
export function tryOnPath(): TryOnPath {
  const photos = getActiveQueryClient()?.getQueryData<MyPhotos>(accountKeys.photos);
  return photos && photos.body.length === 0 && photos.face ? 'face' : 'body';
}

/**
 * "Üzerimde gör" sends a photo to OpenAI (US): the consents of its photo path (`tryOnConsents`). Call it on the
 * CTA BEFORE the credit confirmation opens (one sheet at a time); resolves false when the user said "Şimdi değil".
 */
export function ensureTryOnConsent(): Promise<boolean> {
  return ensureConsents(tryOnConsents(), 'tryon');
}

/** The user declined the try-on consent: nothing was started and nothing is to be reported. */
export class ConsentDeclinedError extends Error {
  constructor() {
    super('consent_declined');
    this.name = 'ConsentDeclinedError';
  }
}

export function isConsentDeclined(error: unknown): boolean {
  return error instanceof ConsentDeclinedError;
}

/** Every start re-checks (no UI when the CTA already asked); a decline rejects with `ConsentDeclinedError`. */
async function requireTryOnConsent(): Promise<void> {
  if (!(await ensureTryOnConsent())) throw new ConsentDeclinedError();
}

/**
 * Starts "Üzerimde gör" (`POST v1/tenant/tryon`). Not queued offline: AI calls need a connection
 * (MOBILE_ENGINEER §Neler çevrimdışı çalışmaz). Each call carries a stable `requestId`, so a retried
 * request opens one job. An image that already exists answers 200 without a job or a credit: the
 * returned `jobId` is then a pseudo id that `useTryOnJob` resolves at once, so callers and the
 * `/tryon/[jobId]` route treat both cases alike. 403 → paywall, 402 → credit sheet.
 *
 *   const tryOn = useStartTryOn();
 *   const { jobId } = await tryOn.start({ kind: 'look', id });
 *   router.push({ pathname: '/tryon/[jobId]', params: { jobId, title: look.name } });
 */
export function useStartTryOn() {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (request: StartTryOnRequest) =>
      fromSource<StartTryOnResponse>(
        'jobs',
        () => startFixtureTryOn(request),
        async () => {
          const target = await toWireTarget(request.target);
          const started = await apiRequest<TryOnStartWire>('v1/tenant/tryon', { method: 'POST', body: { requestId: request.requestId, target } });
          if (started.job) return { jobId: started.job.id };
          if (started.image) return { jobId: cachedTryOnJobId(started.image.id) };
          throw new ApiError('http', 502, null);
        },
      ),
    onError: (error) => void routeAiStartError(error, 'tryon'),
    onSettled: () => void client.invalidateQueries({ queryKey: aiCreditsKey }),
  });
  return {
    isStarting: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
    start: async (target: TryOnTarget) => {
      await requireTryOnConsent();
      const accepted = await mutation.mutateAsync({ requestId: ulid(), target });
      trackTryOnStarted(accepted.jobId, target.kind, tryOnPath());
      // 14b's hero shows "Hazırlanıyor…" for this target until the job ends.
      tryOnRuns.record(target, accepted.jobId);
      return accepted;
    },
    /** Several targets under one confirmation (07b "7 kredi harcanacak"); resolves with the job ids in order. */
    startMany: async (targets: TryOnTarget[]) => {
      await requireTryOnConsent();
      const path = tryOnPath();
      return Promise.all(
        targets.map(async (target) => {
          const accepted = await mutation.mutateAsync({ requestId: ulid(), target });
          trackTryOnStarted(accepted.jobId, target.kind, path);
          return accepted;
        }),
      );
    },
  };
}

/**
 * How long a try-on wait lasts before its area shows "Şu an oluşturamadık. Kredin iade edildi." +
 * "Tekrar dene" (canvas note "Zaman aşımı / hata durumu": 60 s without a result).
 */
export const TRY_ON_TIMEOUT_MS = 60_000;

/**
 * Polls a try-on job; its wire result `{ tryOnImageId }` is resolved to the image (`GET
 * v1/tenant/tryon/{id}`). A pseudo job id of an already existing image skips the polling and reads
 * the image directly. A failed job has its credit refunded by the server.
 */
export function useTryOnJob(
  jobId: string | null | undefined,
  options: { enabled?: boolean; timeoutMs?: number } = {},
): JobView<TryOnResult> {
  const imageId = cachedTryOnImageId(jobId);
  const job = useJob<TryOnResult>('tryon', imageId ? null : jobId, { timeoutMs: TRY_ON_TIMEOUT_MS, ...options, mapResult: mapTryOnResult });
  const image = useQuery({
    queryKey: ['tenant', 'tryon', imageId ?? 'none'] as const,
    enabled: Boolean(imageId) && (options.enabled ?? true),
    queryFn: () => requestTryOnImage(imageId ?? ''),
    // The URL is a short-lived presigned GET: never served from the persisted cache.
    meta: { persist: false },
  });
  if (!imageId) return job;
  const isDone = image.data !== undefined;
  const isFailed = !isDone && image.status === 'error';
  return {
    job: undefined,
    isWorking: !isDone && !isFailed,
    isDone,
    isFailed,
    timedOut: false,
    result: image.data ?? null,
    // Nothing was reserved for an image that already existed.
    creditRefunded: false,
    errorCode: null,
    refetch: () => void image.refetch(),
  };
}

/**
 * Query options of the existing-image check of one target (shared by `useExistingTryOn` and `useCachedTryOns`).
 * `photoKey` (`useTryOnPhotoKey`) is part of the key: a new photo or body type asks again. The check waits until
 * the photos are known and never runs without a usable picture (null: no image can match).
 */
export function existingTryOnQuery(target: TryOnTarget | null, enabled = true, photoKey: TryOnPhotoKey = undefined) {
  return {
    queryKey: ['tenant', 'tryon', 'target', target?.kind ?? 'none', target?.id ?? 'none', photoKey ?? 'none'] as const,
    enabled: Boolean(target) && enabled && typeof photoKey === 'string',
    queryFn: () =>
      fromSource<TryOnResult | null>(
        'jobs',
        () => null,
        () => (target ? requestExistingTryOn(target) : Promise.resolve(null)),
      ),
    meta: { persist: false },
  };
}

/** The check's answer under the stale-photo rule: an image made on another picture path is no image. */
export function currentTryOn(data: TryOnResult | null | undefined, photoKey: TryOnPhotoKey): TryOnResult | null | undefined {
  if (photoKey === null) return null;
  if (data === undefined || data === null) return data;
  return matchesPhotoKey(data, photoKey) ? data : null;
}

/**
 * The existing image of a target with the CURRENT photo (`GET v1/tenant/tryon?kind=&id=&index=`); null when none,
 * also when the photo changed and the old image no longer matches it.
 */
export function useExistingTryOn(target: TryOnTarget | null, options: { enabled?: boolean } = {}) {
  const photoKey = useTryOnPhotoKey();
  const query = useQuery(existingTryOnQuery(target, options.enabled ?? true, photoKey));
  return { ...query, data: currentTryOn(query.data, photoKey) };
}

type WeekQuoteVariables = {
  weekStart: string;
  /** Fixture mode: the days the device would render. */
  fixtureDates: string[];
};
type WeekStartVariables = { requestId: string; quote: TryOnWeekQuote };

/** True for 409 `credit_quote_changed`: the week changed since the quote — quote again and ask again. */
export function isQuoteChanged(error: unknown): boolean {
  return error instanceof ApiError && error.code === CREDIT_QUOTE_CHANGED;
}

/**
 * "Üzerimde gör" for the planned week (07 → 07b): one quote (`POST v1/tenant/tryon/plan-week/quote`,
 * free), ONE confirmation with the total credits, then one batch (`POST v1/tenant/tryon/plan-week` with
 * the confirmed `expectedCredits`, all or nothing). Resolves with day → job id (cached days get a pseudo
 * id). 409 `credit_quote_changed` is left to the screen (re-quote); 402 / 403 open the credit sheet / paywall.
 */
export function useWeekTryOn() {
  const client = useQueryClient();
  const quote = useMutation<TryOnWeekQuote, unknown, WeekQuoteVariables>({
    mutationFn: ({ weekStart, fixtureDates }) =>
      fromSource<TryOnWeekQuote>(
        'jobs',
        () => ({ weekStart, requiredCredits: fixtureDates.length * TRY_ON_CREDIT_COST, cachedCount: 0, dates: fixtureDates }),
        async () => toWeekQuote(await apiRequest<TryOnWeekQuoteWire>('v1/tenant/tryon/plan-week/quote', { method: 'POST', body: { weekStart } })),
      ),
    onError: (error) => void routeAiStartError(error, 'tryon'),
  });
  const start = useMutation<Record<string, string>, unknown, WeekStartVariables>({
    mutationFn: ({ requestId, quote: confirmed }) =>
      fromSource<Record<string, string>>(
        'jobs',
        () =>
          Object.fromEntries(
            confirmed.dates.map((date) => [date, startFixtureTryOn({ requestId: `${requestId}-${date}`, target: { kind: 'plan-day', id: date } }).jobId]),
          ),
        async () =>
          toWeekJobs(
            await apiRequest<TryOnWeekStartWire>('v1/tenant/tryon/plan-week', {
              method: 'POST',
              body: { requestId, weekStart: confirmed.weekStart, expectedCredits: confirmed.requiredCredits },
            }),
          ),
      ),
    onError: (error) => {
      if (!isQuoteChanged(error)) routeAiStartError(error, 'tryon');
    },
    onSettled: () => void client.invalidateQueries({ queryKey: aiCreditsKey }),
  });
  return {
    isQuoting: quote.isPending,
    isStarting: start.isPending,
    error: start.error ?? quote.error,
    reset: () => {
      quote.reset();
      start.reset();
    },
    /** Asks for the try-on consent first (before any credit is quoted or confirmed). */
    quote: async (weekStart: string, fixtureDates: string[]) => {
      await requireTryOnConsent();
      return quote.mutateAsync({ weekStart, fixtureDates });
    },
    /** The `requestId` is created here, once per confirmation. */
    start: async (confirmed: TryOnWeekQuote) => {
      await requireTryOnConsent();
      return start.mutateAsync({ requestId: ulid(), quote: confirmed });
    },
  };
}
