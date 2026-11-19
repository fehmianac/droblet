import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { Job } from '@/api/contracts/jobs';
import type { CalendarMonth, PlanDay } from '@/api/contracts/today';
import type { StylistOutfitResult, StylistSuggestion } from '@/api/contracts/stylist';
import { jobQueryKey } from '@/api/jobs';
import { toast } from '@/components/ui/toast';
import { useLookWrites } from '@/features/looks/api';
import { usePlanDays, usePutPlanDay } from '@/features/today/api';
import { planKeys } from '@/features/today/keys';
import { formatDate, parseLocalDate } from '@/lib/format';
import { suffixed } from '@/lib/trSuffix';
import { newClientMutation } from '@/sync/clientMutation';

import { useAcceptSuggestion } from './api';
import { useAddSuggestedPieces } from './gapFill';
import { setSuggestionState } from './mutations';
import { calendarOptions } from './SuggestionSheets';

/** "Salı 24 Kasım" / "Tuesday 24 November". */
export function longDay(iso: string): string {
  return formatDate(parseLocalDate(iso), { weekday: 'long', day: 'numeric', month: 'long' });
}

/** "Sal 24 Kas" / "Tue 24 Nov" — the added button. */
export function shortDay(iso: string): string {
  return formatDate(parseLocalDate(iso), { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Canvas 13c — what the toast says after "Takvime ekle": "Salı 24 Kasım'a eklendi" or, when the day already had a
 * plan, "Salı 24 Kasım planı güncellendi"; "· Looklarına da kaydedildi" when the look was saved by this action.
 */
export function calendarToastMessage(t: TFunction, language: string, date: string, replaced: boolean, alsoSaved: boolean): string {
  const day = longDay(date);
  const lang = language.startsWith('tr') ? 'tr' : 'en';
  const head = replaced ? t('feedback.calendar.updated', { date: day }) : t('feedback.calendar.added', { date: suffixed(day, 'dative', lang) });
  return alsoSaved ? `${head} · ${t('feedback.calendar.alsoSaved')}` : head;
}

/** The plan record of `date` among every cached plan query (week ranges and calendar months). */
export function cachedPlanDay(client: ReturnType<typeof useQueryClient>, date: string): PlanDay | null {
  for (const [, data] of client.getQueriesData<PlanDay[] | CalendarMonth>({ queryKey: planKeys.planDays })) {
    const list = Array.isArray(data) ? data : data?.planDays;
    const found = list?.find((p) => p.date === date);
    if (found) return found;
  }
  return null;
}

/**
 * The 16b bottom-bar actions with their feedback (canvas 13c): "Takvime ekle" (and change day / remove), the
 * lookbook heart (save / unsave with undo). Every write is queued and optimistic, so the toast speaks at once; a
 * refusal from the server answers with an error toast and "Tekrar dene".
 */
export function useSuggestionActions(jobId: string, result: StylistOutfitResult) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const accept = useAcceptSuggestion(jobId);
  const suggestedPieces = useAddSuggestedPieces();
  const looks = useLookWrites();
  const putPlanDay = usePutPlanDay();

  const options = calendarOptions(result.request.date);
  const planned = result.suggestions.map((s) => s.plannedDate).filter((d): d is string => Boolean(d));
  const range = [...options, ...planned].sort();
  const plans = usePlanDays(range[0] ?? result.request.date, range[range.length - 1] ?? result.request.date);
  /** Days of the sheet that already have a look planned. */
  const plannedDays = new Set((plans.data ?? []).filter((p) => p.lookId).map((p) => p.date));

  /** Library picks join the wardrobe first: the accepted look then holds the user's own pieces. */
  const acceptWithPieces = (s: StylistSuggestion, date: string | null, onError: (error: unknown) => void): string | null => {
    const ids = s.pieces.filter((p) => p.source === 'library').map((p) => p.refId);
    if (ids.length === 0) return accept.accept(s.index, date, null, { onError });
    // The look id is only known once the pieces are in; the toast's "Gör" waits for the suggestion state.
    void suggestedPieces
      .add(ids)
      .then(() => accept.accept(s.index, date, null, { onError }))
      .catch((e: unknown) => onError(e));
    return null;
  };

  const openLook = (s: StylistSuggestion, lookId: string | null) => {
    const id = lookId ?? findSuggestion(client, jobId, s.index)?.savedLookId ?? null;
    if (id) router.push({ pathname: '/look/[id]', params: { id } });
  };

  const save = (s: StylistSuggestion) => {
    const lookId = acceptWithPieces(s, null, () =>
      toast.error(t('feedback.save.failed'), { action: { label: t('common.retry'), onPress: () => save(s) }, testID: 'toast-save-failed' }),
    );
    toast.success(t('feedback.save.saved'), {
      icon: 'heartFilled',
      action: { label: t('feedback.see'), onPress: () => openLook(s, lookId) },
      testID: 'toast-saved',
    });
  };

  /** A filled heart: a planned look stays (it is on the calendar); otherwise the look made from this suggestion is deleted, with undo. */
  const unsave = (s: StylistSuggestion) => {
    if (!s.savedLookId) return;
    if (s.plannedDate) {
      toast.info(t('feedback.save.keptPlanned'), { testID: 'toast-kept-planned' });
      return;
    }
    looks.remove({ id: s.savedLookId });
    setSuggestionState(client, jobId, s.index, { savedLookId: null });
    toast.success(t('feedback.save.removed'), {
      icon: 'heart',
      action: { label: t('feedback.undo'), onPress: () => save({ ...s, savedLookId: null }) },
      testID: 'toast-unsaved',
    });
  };

  const calendarToast = (date: string, replaced: boolean, alsoSaved: boolean) =>
    toast.success(calendarToastMessage(t, i18n.language, date, replaced, alsoSaved), {
      action: { label: t('feedback.calendar.see'), onPress: () => router.push({ pathname: '/plan/week', params: { day: date } }) },
      testID: 'toast-calendar',
    });

  const calendarFailed = (s: StylistSuggestion, date: string) =>
    toast.error(t('feedback.calendar.failed'), { action: { label: t('common.retry'), onPress: () => addToCalendar(s, date) }, testID: 'toast-calendar-failed' });

  /** Plans `date`. A look not saved yet is created by the accept (one write); a saved one is planned with the plan-day write. */
  const addToCalendar = (s: StylistSuggestion, date: string) => {
    const existing = cachedPlanDay(client, date);
    const replaced = Boolean(existing?.lookId) && existing?.lookId !== s.savedLookId;
    if (!s.savedLookId) {
      acceptWithPieces(s, date, () => calendarFailed(s, date));
      calendarToast(date, replaced, true);
      return;
    }
    // Moving the day: the old day is cleared when it still holds this look.
    if (s.plannedDate && s.plannedDate !== date) {
      const old = cachedPlanDay(client, s.plannedDate);
      if (old?.lookId === s.savedLookId) putPlanDay.put(old, s.plannedDate, { occasion: null, lookId: null });
    }
    putPlanDay.mutate(
      { date, occasion: result.request.occasion ?? null, lookId: s.savedLookId, baseVersion: existing?.baseVersion ?? 0, ...newClientMutation() },
      { onError: () => calendarFailed(s, date) },
    );
    setSuggestionState(client, jobId, s.index, { plannedDate: date });
    calendarToast(date, replaced, false);
  };

  /** "Takvimden çıkar": clears the day when it still holds this look; "Geri al" plans it again. */
  const removeFromCalendar = (s: StylistSuggestion) => {
    const date = s.plannedDate;
    if (!date) return;
    const current = cachedPlanDay(client, date);
    if (!current || current.lookId === s.savedLookId) putPlanDay.put(current, date, { occasion: null, lookId: null });
    setSuggestionState(client, jobId, s.index, { plannedDate: null });
    toast.success(t('feedback.calendar.removed', { date: longDay(date) }), {
      action: { label: t('feedback.undo'), onPress: () => addToCalendar({ ...s, plannedDate: null }, date) },
      testID: 'toast-calendar-removed',
    });
  };

  return { plannedDays, save, unsave, addToCalendar, removeFromCalendar };
}

function findSuggestion(client: ReturnType<typeof useQueryClient>, jobId: string, index: number): StylistSuggestion | undefined {
  const job = client.getQueryData<Job<StylistOutfitResult>>(jobQueryKey(jobId));
  return job?.result?.suggestions.find((s) => s.index === index);
}

