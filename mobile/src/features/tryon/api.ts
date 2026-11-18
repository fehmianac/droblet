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
  toWireTarget,
  type TryOnStartWire,
} from '@/api/wire/tryon';
import { routeAiStartError } from '@/features/credits/aiErrors';
import { aiCreditsKey } from '@/features/credits/useAiCredits';
import { fixtureDb } from '@/fixtures/db';
import { fixtureJobOptions, startFixtureJob } from '@/fixtures/jobs';
import { ulid } from '@/lib/ids';

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
    start: (target: TryOnTarget) => mutation.mutateAsync({ requestId: ulid(), target }),
    /** Several targets under one confirmation (07b "7 kredi harcanacak"); resolves with the job ids in order. */
    startMany: (targets: TryOnTarget[]) => Promise.all(targets.map((target) => mutation.mutateAsync({ requestId: ulid(), target }))),
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

/** The existing image of a target with the current body photo (`GET v1/tenant/tryon?kind=&id=&index=`); null when none. */
export function useExistingTryOn(target: TryOnTarget | null, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['tenant', 'tryon', 'target', target?.kind ?? 'none', target?.id ?? 'none'] as const,
    enabled: Boolean(target) && (options.enabled ?? true),
    queryFn: () =>
      fromSource<TryOnResult | null>(
        'jobs',
        () => null,
        () => (target ? requestExistingTryOn(target) : Promise.resolve(null)),
      ),
    meta: { persist: false },
  });
}
