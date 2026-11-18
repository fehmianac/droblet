import { useSyncExternalStore } from 'react';

import type { ConsentSource, ConsentState, ConsentType } from '@/api/contracts/consents';
import { getActiveQueryClient } from '@/sync/activeClient';

import { consentKeys, fetchConsents, invalidOf } from './api';

/**
 * The just-in-time consent sheet, opened from anywhere (a gate before a feature, or a 403
 * `consent_required` answer). One request at a time; a second one for the same types joins it.
 * `ConsentHost` renders the sheet and settles the request with the user's answer.
 */
export type ConsentRequest = { types: ConsentType[]; source: ConsentSource };

type Pending = ConsentRequest & { settle: (granted: boolean) => void; promise: Promise<boolean> };

let pending: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const sameTypes = (a: readonly ConsentType[], b: readonly ConsentType[]) => a.length === b.length && a.every((t) => b.includes(t));

export const consentRequests = {
  /** Opens the sheet for `types`; resolves true once all of them are recorded, false on "Şimdi değil". */
  request(types: ConsentType[], source: ConsentSource): Promise<boolean> {
    if (types.length === 0) return Promise.resolve(true);
    if (pending) {
      if (sameTypes(pending.types, types)) return pending.promise;
      pending.settle(false);
    }
    let settle: (granted: boolean) => void = () => undefined;
    const promise = new Promise<boolean>((resolve) => {
      settle = (granted) => {
        if (pending?.promise === promise) {
          pending = null;
          emit();
        }
        resolve(granted);
      };
    });
    pending = { types, source, settle, promise };
    emit();
    return promise;
  },
  get: (): ConsentRequest | null => (pending ? { types: pending.types, source: pending.source } : null),
  settle(granted: boolean) {
    pending?.settle(granted);
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

let snapshot: ConsentRequest | null = null;
let snapshotOf: Pending | null = null;
function read(): ConsentRequest | null {
  if (snapshotOf !== pending) {
    snapshotOf = pending;
    snapshot = consentRequests.get();
  }
  return snapshot;
}

export function useConsentRequest(): ConsentRequest | null {
  return useSyncExternalStore(consentRequests.subscribe, read, read);
}

/**
 * The gate in front of a feature that needs consent: true at once when every type is valid (cached
 * state, else read from the server), otherwise the sheet asks. When the state cannot be read (offline)
 * the sheet still asks — the grant itself then reports the failure.
 */
export async function ensureConsents(types: readonly ConsentType[], source: ConsentSource): Promise<boolean> {
  const client = getActiveQueryClient();
  let state = client?.getQueryData<ConsentState>(consentKeys.all);
  if (invalidOf(state, types).length > 0) {
    try {
      state = client ? await client.fetchQuery({ queryKey: consentKeys.all, queryFn: fetchConsents, staleTime: 0 }) : await fetchConsents();
    } catch {
      // Unknown: ask.
    }
  }
  const missing = invalidOf(state, types);
  if (missing.length === 0) return true;
  return consentRequests.request(missing, source);
}
