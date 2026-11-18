import type { ContactHash } from '@/api/contracts/social';

/**
 * Contacts matching, the part that runs on the device (docs/privacy/contacts-matching.md). Pure: the
 * SHA-256 function is injected (expo-crypto in the app, node:crypto in tests).
 *
 * For every e-mail address in the contacts:
 *   id = address.trim().toLowerCase()
 *   h0 = hex(SHA-256(id))                         — never leaves the device in full
 *   p  = h0.slice(0, prefixLength)                — a short bucket so the server can find candidates
 *   h  = hex(SHA-256(salt + ":email:" + h0))      — salted with the single-use salt of this request
 * Only `{ p, h }` is uploaded. Raw addresses, names and phone numbers never leave the phone; the salt
 * changes per request, so an uploaded hash is useless outside that one request.
 */
export type Sha256Hex = (text: string) => Promise<string>;

export type HashParams = { salt: string; prefixLength: number; maxHashes: number };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed + lower-cased; null when it is not an e-mail address. */
export function normaliseEmail(raw: string | null | undefined): string | null {
  const id = (raw ?? '').trim().toLowerCase();
  return EMAIL.test(id) ? id : null;
}

/** Distinct normalised addresses, in first-seen order. */
export function distinctEmails(raw: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const value of raw) {
    const id = normaliseEmail(value);
    if (id) seen.add(id);
  }
  return [...seen];
}

/** The upload for one request: at most `maxHashes` entries, no duplicates. */
export async function hashContactEmails(raw: (string | null | undefined)[], params: HashParams, sha256Hex: Sha256Hex): Promise<ContactHash[]> {
  const emails = distinctEmails(raw).slice(0, Math.max(0, params.maxHashes));
  return Promise.all(
    emails.map(async (id) => {
      const h0 = (await sha256Hex(id)).toLowerCase();
      const h = (await sha256Hex(`${params.salt}:email:${h0}`)).toLowerCase();
      return { p: h0.slice(0, params.prefixLength), h };
    }),
  );
}
