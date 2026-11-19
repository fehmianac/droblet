import type { QueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type { Job } from '@/api/contracts/jobs';
import type { AcceptSuggestionRequest, AcceptSuggestionResponse, StylistFeedbackRequest, StylistOutfitResult } from '@/api/contracts/stylist';
import { jobQueryKey } from '@/api/jobs';
import { fromSource } from '@/api/dataSource';
import { fromAcceptSuggestion, fromDislikeReasons, toAcceptedSuggestion, type AcceptedSuggestionWire } from '@/api/wire/stylist';
import { lookKeys } from '@/features/looks/queries';
import { planKeys } from '@/features/today/keys';
import { acceptFixtureSuggestion } from '@/fixtures/stylist';
import { queryKeys, TENANT_WRITE_SCOPE } from '@/sync/queryKeys';

export const stylistMutationKeys = {
  acceptSuggestion: ['tenant', 'stylist', 'suggestion', 'accept'] as const,
  feedback: ['tenant', 'feedback', 'stylist'] as const,
};

export type AcceptSuggestionVariables = AcceptSuggestionRequest & { jobId: string; index: number };

/**
 * Sets what this device knows about a suggestion (saved look, planned day). These are client-side facts: the job
 * result from the server never carries them (`toStylistSuggestion` keeps the previous ones), so an unsave or a
 * removal from the calendar is written here, next to the look / plan-day write that does it on the server.
 */
export function setSuggestionState(
  client: QueryClient,
  jobId: string,
  index: number,
  next: { savedLookId?: string | null; plannedDate?: string | null },
): void {
  client.setQueryData<Job<StylistOutfitResult>>(jobQueryKey(jobId), (job) =>
    job?.result
      ? {
          ...job,
          result: {
            ...job.result,
            suggestions: job.result.suggestions.map((s) =>
              s.index === index
                ? {
                    ...s,
                    savedLookId: next.savedLookId !== undefined ? next.savedLookId : s.savedLookId,
                    plannedDate: next.plannedDate !== undefined ? next.plannedDate : s.plannedDate,
                  }
                : s,
            ),
          },
        }
      : job,
  );
}

/**
 * Queued writes of the stylist feature. Paused mutations are persisted without their function, so every
 * write must register its `mutationFn` here by key to resume after an app restart.
 */
export function registerStylistMutations(client: QueryClient): void {
  const patchSuggestion = (vars: AcceptSuggestionVariables, lookId: string | null, plannedDate: string | null) =>
    client.setQueryData<Job<StylistOutfitResult>>(jobQueryKey(vars.jobId), (job) =>
      job?.result
        ? {
            ...job,
            result: {
              ...job.result,
              suggestions: job.result.suggestions.map((s) =>
                s.index === vars.index ? { ...s, savedLookId: lookId ?? s.savedLookId, plannedDate: plannedDate ?? s.plannedDate } : s,
              ),
            },
          }
        : job,
    );

  // "Takvime ekle" (with a date) and the heart (without): suggestion → Look (+ PlanDay). Optimistic.
  client.setMutationDefaults(stylistMutationKeys.acceptSuggestion, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: ({ jobId, index, ...body }: AcceptSuggestionVariables) =>
      fromSource<AcceptSuggestionResponse>(
        'stylist',
        () => acceptFixtureSuggestion(jobId, index, body),
        async () =>
          toAcceptedSuggestion(
            await apiRequest<AcceptedSuggestionWire>(`v1/tenant/stylist/suggestion/${jobId}/${index}/accept`, {
              method: 'POST',
              body: fromAcceptSuggestion(body),
            }),
          ),
      ),
    onMutate: (vars: AcceptSuggestionVariables) => {
      patchSuggestion(vars, vars.lookId, vars.date);
    },
    onSuccess: (saved: AcceptSuggestionResponse | undefined, vars: AcceptSuggestionVariables) => {
      if (saved) patchSuggestion(vars, saved.lookId, saved.plannedDate);
    },
    onError: (_error: unknown, vars: AcceptSuggestionVariables) => {
      void client.invalidateQueries({ queryKey: jobQueryKey(vars.jobId) });
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: lookKeys.looks });
      void client.invalidateQueries({ queryKey: planKeys.planDays });
      void client.invalidateQueries({ queryKey: queryKeys.today });
    },
  });

  // "Beğenmedim" — `POST …/dislike { reason }` (204); an event, nothing to roll back.
  client.setMutationDefaults(stylistMutationKeys.feedback, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (body: StylistFeedbackRequest) =>
      fromSource<void>(
        'stylist',
        () => undefined,
        () =>
          apiRequest<void>(`v1/tenant/stylist/suggestion/${body.jobId}/${body.index}/dislike`, {
            method: 'POST',
            body: { reason: fromDislikeReasons(body.reasons) },
          }),
      ),
  });
}
