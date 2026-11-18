import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import {
  CONSENT_TEXT_VERSION,
  type ConsentRecord,
  type ConsentSource,
  type ConsentState,
  type ConsentType,
  type PutConsentsRequest,
} from '@/api/contracts/consents';
import { fromSource } from '@/api/dataSource';
import { consentFixtures } from '@/fixtures/consents';
import { currentLanguage } from '@/i18n';
import { accountKeys } from '@/features/account/queries';
import { queryKeys } from '@/sync/queryKeys';

export const consentKeys = { all: ['tenant', 'consents'] as const };

export function fetchConsents(): Promise<ConsentState> {
  return fromSource<ConsentState>('consents', consentFixtures.get, () => apiRequest<ConsentState>('v1/tenant/consents'));
}

/** The six consent records (`GET v1/tenant/consents`). Never persisted: the server is the record. */
export function useConsents() {
  return useQuery({ queryKey: consentKeys.all, queryFn: fetchConsents, meta: { persist: false } });
}

export function recordOf(state: ConsentState | undefined, type: ConsentType): ConsentRecord | undefined {
  return state?.consents.find((c) => c.type === type);
}

/** Types of `types` that are not valid in `state` (unknown state = all of them). */
export function invalidOf(state: ConsentState | undefined, types: readonly ConsentType[]): ConsentType[] {
  return types.filter((type) => !recordOf(state, type)?.valid);
}

export type ConsentDecision = { type: ConsentType; granted: boolean };

/**
 * `PUT v1/tenant/consents`. Interactive and online-only: a consent is recorded when the user gives it,
 * never replayed later from a queue. Grants carry the version of the text this build shows.
 */
export async function saveConsents(client: QueryClient, decisions: ConsentDecision[], source: ConsentSource): Promise<ConsentState> {
  const body: PutConsentsRequest = {
    consents: decisions.map((d) => ({ type: d.type, granted: d.granted, version: CONSENT_TEXT_VERSION[d.type] })),
    source,
    locale: currentLanguage(),
  };
  const state = await fromSource<ConsentState>(
    'consents',
    () => consentFixtures.put(body),
    () => apiRequest<ConsentState>('v1/tenant/consents', { method: 'PUT', body }),
  );
  client.setQueryData(consentKeys.all, state);
  // Server side effects of a withdrawal: marketing switches the weekly edit / price drops off, weight clears the weight.
  if (decisions.some((d) => !d.granted && d.type === 'marketingNotifications')) void client.invalidateQueries({ queryKey: accountKeys.notifications });
  if (decisions.some((d) => !d.granted && d.type === 'weight')) void client.invalidateQueries({ queryKey: queryKeys.bodyProfile });
  return state;
}

export function useSaveConsents() {
  const client = useQueryClient();
  return useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: ({ decisions, source }: { decisions: ConsentDecision[]; source: ConsentSource }) => saveConsents(client, decisions, source),
  });
}
