import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CryptoDigestAlgorithm, CryptoEncoding, digestStringAsync } from 'expo-crypto';
import * as Contacts from 'expo-contacts/legacy';

import { apiRequest } from '@/api/client';
import type { PersonSuggestion } from '@/api/contracts/social';
import { fromSource } from '@/api/dataSource';
import { toPersonSuggestion, type ContactMatchRequestWire, type ContactMatchResponseWire, type ContactSaltWire } from '@/api/wire/social';
import { socialFixtures } from '@/fixtures/social';

import { hashContactEmails, type Sha256Hex } from './contactHashing';

/** Matches of the last run (memory only — never persisted: `meta.persist: false`). */
export const contactKeys = { matches: ['tenant', 'social', 'contacts'] as const };

export type ContactsPermission = 'granted' | 'denied' | 'undetermined';

const sha256Hex: Sha256Hex = (text) => digestStringAsync(CryptoDigestAlgorithm.SHA256, text, { encoding: CryptoEncoding.HEX });

export async function contactsPermission(): Promise<ContactsPermission> {
  const { status } = await Contacts.getPermissionsAsync();
  return status === Contacts.PermissionStatus.GRANTED ? 'granted' : status === Contacts.PermissionStatus.DENIED ? 'denied' : 'undetermined';
}

/** Asked only after the consent screen. `canAskAgain: false` → the user has to go to Settings. */
export async function requestContactsPermission(): Promise<{ granted: boolean; canAskAgain: boolean }> {
  const result = await Contacts.requestPermissionsAsync();
  return { granted: result.status === Contacts.PermissionStatus.GRANTED, canAskAgain: result.canAskAgain };
}

/** Only the e-mail field is read from the address book; names and numbers are not requested. */
async function readContactEmails(): Promise<string[]> {
  const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.Emails] });
  return data.flatMap((contact) => (contact.emails ?? []).map((e) => e.email ?? ''));
}

/**
 * The whole run: read the addresses, get a single-use salt, hash on the device, upload the hashes,
 * get the people found. Nothing is stored on the device or the server; the result lives in memory.
 */
async function runMatch(): Promise<PersonSuggestion[]> {
  const emails = await readContactEmails();
  return fromSource(
    'social',
    () => socialFixtures.matchContacts(emails.map((e) => ({ p: e.slice(0, 3), h: e }))),
    async () => {
      const salt = await apiRequest<ContactSaltWire>('v1/tenant/contacts/salt', { method: 'POST' });
      const hashes = await hashContactEmails(emails, salt, sha256Hex);
      if (hashes.length === 0) return [];
      const body: ContactMatchRequestWire = { saltId: salt.saltId, hashes };
      const res = await apiRequest<ContactMatchResponseWire>('v1/tenant/contacts/match', { method: 'POST', body });
      return res.matches.map(toPersonSuggestion);
    },
  );
}

/** The matches as a cache entry, so follow taps update the rows like everywhere else. */
export function useContactMatches() {
  return useQuery<PersonSuggestion[]>({
    queryKey: contactKeys.matches,
    enabled: false,
    meta: { persist: false },
    queryFn: () => Promise.resolve([]),
  });
}

/** Interactive and online: the user sees the run happen (no queue, no retry). */
export function useRunContactMatch() {
  const client = useQueryClient();
  return useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: runMatch,
    onSuccess: (matches) => client.setQueryData<PersonSuggestion[]>(contactKeys.matches, matches),
  });
}
