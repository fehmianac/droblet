import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type { AgeBand, TeenState } from '@/api/contracts/teen';
import type { ProfileWire } from '@/api/wire/core';
import { toTeenState, type TeenStateWire } from '@/api/wire/teen';
import { sessionStore } from '@/auth/session';
import { currentLanguage } from '@/i18n';

import { teenStore } from './store';

/**
 * Teen mode calls (docs/api/teen.md §3, §5). The age state is read from the API in every build — like `GET v1/config`
 * it has no fixture: the showcase build's local mock answers it, Jest tests mock `apiRequest`.
 */
export const teenKeys = { state: ['tenant', 'teen'] as const };

export function readTeenState(): Promise<TeenState> {
  return apiRequest<TeenStateWire>('v1/tenant/teen').then(toTeenState);
}

/** Keeps the store, the cache and the session's remembered band in step with one server answer. */
export async function applyTeenState(client: QueryClient | null, state: TeenState): Promise<void> {
  teenStore.setState(state);
  client?.setQueryData(teenKeys.state, state);
  if (state.ageBand) await sessionStore.updateUser({ ageBand: state.ageBand });
}

/**
 * `GET v1/tenant/teen` — polled every 30 s while a parent's answer is awaited (pending), so the approval shows up
 * without a restart; otherwise on focus. Not persisted: the server is the record.
 */
export function useTeenState(options: { enabled: boolean; polling: boolean }) {
  return useQuery({
    queryKey: teenKeys.state,
    enabled: options.enabled,
    queryFn: readTeenState,
    meta: { persist: false },
    refetchInterval: options.polling ? 30_000 : false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}

/** 02i "Onay bağlantısını gönder": `POST v1/tenant/teen/parental-consent` (replaces an open request). */
export function useRequestParentalConsent() {
  const client = useQueryClient();
  return useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async (parentEmail: string) => {
      const state = toTeenState(await apiRequest<TeenStateWire>('v1/tenant/teen/parental-consent', { method: 'POST', body: { parentEmail } }));
      await applyTeenState(client, state);
      return state;
    },
  });
}

/** 02j "Bağlantıyı tekrar gönder": same address, a fresh 7-day link. */
export function useResendParentalConsent() {
  const client = useQueryClient();
  return useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async () => {
      const state = toTeenState(await apiRequest<TeenStateWire>('v1/tenant/teen/parental-consent/resend', { method: 'POST' }));
      await applyTeenState(client, state);
      return state;
    },
  });
}

/** The band and teen object of a profile answer (`ageBand` absent on older servers = adult). */
export function teenStateOfProfile(profile: ProfileWire): TeenState | null {
  if (!('ageBand' in profile)) return null;
  return toTeenState({ ageBand: profile.ageBand ?? null, teen: profile.teen ?? null });
}

/**
 * 02f — Apple / Google: `POST v1/tenant/profile/age-confirmation` with the birth year (and month). Under 16 the server
 * deletes the account (`422 age_under_minimum`, `accountDeleted: true`): the caller shows 02g and signs out.
 */
export function useConfirmBirthYear() {
  const client = useQueryClient();
  return useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async ({ birthYear, birthMonth }: { birthYear: number; birthMonth: number | null }) => {
      const body = birthMonth ? { birthYear, birthMonth } : { birthYear };
      const profile = await apiRequest<ProfileWire>('v1/tenant/profile/age-confirmation', { method: 'POST', body });
      const state = teenStateOfProfile(profile);
      const band: AgeBand = state?.ageBand ?? 'adult';
      if (state) teenStore.setState(state);
      client.setQueryData(teenKeys.state, state ?? { ageBand: band, teen: null });
      await sessionStore.updateUser({ ageConfirmed: true, ageBand: band });
      return band;
    },
  });
}

type ConsentListWire = { consents: { type: string; currentVersion: string }[] };

/** Fallback when the consent list does not carry the record (older server): the parent text version of teen mode. */
const TEEN_TRY_ON_TEXT_VERSION = '2026-11-21';

/**
 * 22t "Anladım, dene": the teen's own `teenTryOn` consent (`PUT v1/tenant/consents`). Kept out of the app's general
 * consent list (adults never see it); the version is the server's current one.
 */
export function useGrantTeenTryOn() {
  const client = useQueryClient();
  return useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async () => {
      // The teen state carries the current version; the consent list is the fallback (older server answers).
      let version = teenStore.get().state?.teen?.ownTryOnConsentVersion ?? null;
      if (!version) {
        try {
          const list = await apiRequest<ConsentListWire>('v1/tenant/consents');
          version = list.consents.find((c) => c.type === 'teenTryOn')?.currentVersion ?? null;
        } catch {
          // The PUT below still tells the truth (409 when the version moved on).
        }
      }
      version ??= TEEN_TRY_ON_TEXT_VERSION;
      await apiRequest<unknown>('v1/tenant/consents', {
        method: 'PUT',
        body: { consents: [{ type: 'teenTryOn', granted: true, version }], source: 'tryon', locale: currentLanguage() },
      });
      const fresh = await readTeenState();
      await applyTeenState(client, fresh);
      return fresh;
    },
  });
}
