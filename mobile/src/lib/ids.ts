import { getRandomValues } from 'expo-crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID (time-sortable, 26 chars). Used for client-generated ids and `clientMutationId`. */
export function ulid(now: number = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = getRandomValues(new Uint8Array(16));
  let random = '';
  for (let i = 0; i < 16; i++) {
    random += CROCKFORD[(bytes[i] ?? 0) % 32];
  }
  return time + random;
}
