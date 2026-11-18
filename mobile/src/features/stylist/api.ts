import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';

import { apiRequest } from '@/api/client';
import type { Occasion } from '@/api/contracts';
import {
  STYLIST_TEXT_MAX,
  STYLIST_TEXT_MIN,
  type AcceptSuggestionResponse,
  type StylistDislikeReason,
  type StylistFeedbackRequest,
  type StylistOutfitRequest,
  type StylistOutfitResponse,
  type StylistOutfitResult,
  type StylistWeather,
  type WeatherForecastResponse,
} from '@/api/contracts/stylist';
import { useJob, type JobView } from '@/api/jobs';
import { fromSource } from '@/api/dataSource';
import { fixtureWeather, startFixtureStylistOutfit } from '@/fixtures/stylist';
import { toIsoDate } from '@/lib/format';
import { ulid } from '@/lib/ids';
import { newClientMutation } from '@/sync/clientMutation';

import { stylistMutationKeys, type AcceptSuggestionVariables } from './mutations';

export const stylistKeys = {
  weather: (date: string) => ['weather', 'stylist', date] as const,
  /** The request behind a job, kept so a failed job can be retried with the same input. */
  request: (jobId: string) => ['tenant', 'stylist', 'request', jobId] as const,
  /** Try-on job ids per suggestion index, so leaving and re-opening the result resumes the wait. */
  tryOns: (jobId: string) => ['tenant', 'stylist', 'try-on', jobId] as const,
};

export type StylistDraft = {
  date: string;
  occasion: Occasion | null;
  text: string;
  wardrobeOnly: boolean;
  itemIds: string[];
};

export type StylistDraftProblem = 'needs_input' | 'text_too_short' | 'text_too_long' | 'bad_date';

/** What 16 checks before "Kombin öner": an occasion or a few words, a real calendar day. */
export function validateStylistDraft(draft: StylistDraft): StylistDraftProblem | null {
  const text = draft.text.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return 'bad_date';
  if (text.length > STYLIST_TEXT_MAX) return 'text_too_long';
  if (!draft.occasion && text.length === 0) return 'needs_input';
  if (!draft.occasion && text.length < STYLIST_TEXT_MIN) return 'text_too_short';
  return null;
}

export function toStylistRequest(draft: StylistDraft, requestId: string = ulid()): StylistOutfitRequest {
  const text = draft.text.trim();
  return {
    requestId,
    date: draft.date,
    occasion: draft.occasion,
    text: text.length > 0 ? text : null,
    cityId: null,
    wardrobeOnly: draft.wardrobeOnly,
    ...(draft.itemIds.length > 0 ? { itemIds: draft.itemIds } : {}),
  };
}

/** Accepts only a well-formed `YYYY-MM-DD` route param; anything else falls back to today. */
export function dateParamOrToday(value: string | undefined, today: Date = new Date()): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : toIsoDate(today);
}

/** Weather badge on 16. A failed read is a normal state ("hava alınamadı"), not a screen error. */
export function useStylistWeather(date: string) {
  return useQuery({
    queryKey: stylistKeys.weather(date),
    retry: false,
    queryFn: () =>
      fromSource<WeatherForecastResponse>(
        'stylist',
        () => fixtureWeather(date),
        () => apiRequest<WeatherForecastResponse>(`v1/weather?from=${date}&to=${date}`),
      ),
    select: (data): StylistWeather | null => {
      const day = data.days.find((d) => d.date === date) ?? data.days[0];
      return day ? { temperatureC: day.temperatureC, summary: day.summary, city: data.city } : null;
    },
  });
}

/**
 * Starts a "Kombin öner" job. Not queued offline — AI needs a connection. The request is remembered
 * under the job id so the result screen can retry a failed job with a fresh `requestId`.
 */
export function useStartStylistOutfit() {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (request: StylistOutfitRequest) =>
      fromSource<StylistOutfitResponse>(
        'stylist',
        () => startFixtureStylistOutfit(request),
        () => apiRequest<StylistOutfitResponse>('v1/tenant/stylist/outfit', { method: 'POST', body: request }),
      ),
    onSuccess: (accepted, request) => {
      client.setQueryData(stylistKeys.request(accepted.jobId), request);
    },
  });
  return {
    isStarting: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
    start: (draft: StylistDraft) => mutation.mutateAsync(toStylistRequest(draft)),
    /** Same input, new request id (a failed job is never resumed). Null when the input is no longer known. */
    restart: (jobId: string) => {
      const previous = client.getQueryData<StylistOutfitRequest>(stylistKeys.request(jobId));
      return previous ? mutation.mutateAsync({ ...previous, requestId: ulid() }) : null;
    },
  };
}

/** The stilist wait stops after 60 s without a result (canvas note "Zaman aşımı / hata durumu"). */
export const STYLIST_TIMEOUT_MS = 60_000;

export function useStylistJob(
  jobId: string | null | undefined,
  options: { enabled?: boolean; timeoutMs?: number } = {},
): JobView<StylistOutfitResult> {
  return useJob<StylistOutfitResult>('stylist-outfit', jobId, { timeoutMs: STYLIST_TIMEOUT_MS, ...options });
}

/** "Takvime ekle" (date) / heart (no date) — queued, optimistic (see mutations.ts). */
export function useAcceptSuggestion(jobId: string) {
  const m = useMutation<AcceptSuggestionResponse, unknown, AcceptSuggestionVariables>({
    mutationKey: stylistMutationKeys.acceptSuggestion,
  });
  return {
    isPending: m.isPending,
    accept: (index: number, date: string | null, existingLookId: string | null) =>
      m.mutate({ jobId, index, lookId: existingLookId ?? ulid(), date, ...newClientMutation() }),
  };
}

/** "Beğenmedim" — queued feedback event. */
export function useSuggestionFeedback(jobId: string) {
  const m = useMutation<void, unknown, StylistFeedbackRequest>({ mutationKey: stylistMutationKeys.feedback });
  return {
    send: (index: number, reasons: StylistDislikeReason[], note: string) =>
      m.mutate({ kind: 'stylist_suggestion', jobId, index, reasons, note: note.trim() || null, ...newClientMutation() }),
  };
}

/** Try-on job ids of a result's suggestions (kept in the persisted cache, not on the server). */
export function useSuggestionTryOns(jobId: string) {
  const client = useQueryClient();
  const key = stylistKeys.tryOns(jobId);
  const query = useQuery({
    queryKey: key,
    queryFn: () => client.getQueryData<Record<number, string>>(key) ?? {},
    staleTime: Infinity,
  });
  return {
    jobs: query.data ?? {},
    set: (index: number, tryOnJobId: string | null) =>
      client.setQueryData<Record<number, string>>(key, (prev) => {
        const next = { ...(prev ?? {}) };
        if (tryOnJobId) next[index] = tryOnJobId;
        else delete next[index];
        return next;
      }),
  };
}

/**
 * The three sentences of the stilist wait (`AiYukleniyorStilist`): the wardrobe, the day's weather
 * ("Hava 14°, hafif yağmur…" when the forecast has a summary) and the number of outfits on the way.
 */
export function stylistWaitLines(
  t: TFunction,
  weather: { temperatureC: number; summary?: string | null } | null,
  count: number,
  language: string,
): string[] {
  const temperature = weather ? Math.round(weather.temperatureC) : null;
  const summary = weather?.summary?.trim().toLocaleLowerCase(language) || null;
  return [
    t('ai.stylistLines.wardrobe'),
    temperature === null
      ? t('ai.stylistLines.weatherUnknown')
      : summary
        ? t('ai.stylistLines.weatherSummary', { temperature, summary })
        : t('ai.stylistLines.weather', { temperature }),
    t('ai.stylistLines.outfits', { count }),
  ];
}
