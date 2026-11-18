import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type { StartTryOnRequest, StartTryOnResponse, TryOnResult, TryOnTarget, TryOnTargetKind } from '@/api/contracts/tryon';
import { ApiError } from '@/api/errors';
import { useJob, type JobView } from '@/api/jobs';
import { fromSource } from '@/api/dataSource';
import { aiCreditsKey } from '@/features/credits/useAiCredits';
import { fixtureDb } from '@/fixtures/db';
import { fixtureJobOptions, startFixtureJob } from '@/fixtures/jobs';
import { ulid } from '@/lib/ids';

/** Every try-on image costs one credit (README §9.1). Shown before starting; the server is authoritative. */
export const TRY_ON_CREDIT_COST = 1;

const TARGET_KINDS: readonly TryOnTargetKind[] = ['look', 'product', 'suggestion', 'plan-day', 'trip-day'];

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
      imageUrl: null,
      creditsRemaining: fixtureDb.entitlement.credits.remaining,
    }),
    { id: `job_${request.requestId}` },
  );
  return { jobId };
}

/**
 * Starts "Üzerimde gör" jobs. Not queued offline: AI calls need a connection (MOBILE_ENGINEER §Neler
 * çevrimdışı çalışmaz). Each call carries a stable `requestId`, so a retried request opens one job.
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
        () => apiRequest<StartTryOnResponse>('v1/tenant/tryon', { method: 'POST', body: request }),
      ),
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

/** Polls a try-on job; refreshes the credit counter when it settles (a failed job returns its credit). */
export function useTryOnJob(jobId: string | null | undefined, options: { enabled?: boolean } = {}): JobView<TryOnResult> {
  return useJob<TryOnResult>('tryon', jobId, options);
}
