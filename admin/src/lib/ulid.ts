// Crockford base32 ULID (time-sortable id) for new Akış posts / stories; the API accepts it as the route id.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newUlid(now: number = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let random = '';
  for (const b of bytes) random += ALPHABET[b % 32];
  return time + random;
}
