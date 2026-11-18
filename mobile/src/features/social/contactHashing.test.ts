import { distinctEmails, hashContactEmails, normaliseEmail } from './contactHashing';

// Node's own SHA-256 as the reference implementation (no @types/node in this app).
type Hash = { update: (data: string, encoding?: string) => Hash; digest: (encoding: 'hex') => string };
const { createHash } = jest.requireActual<{ createHash: (algorithm: string) => Hash }>('crypto');

const sha = async (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const params = { salt: 'c2FsdC12ZWN0b3I', prefixLength: 3, maxHashes: 1000 };

describe('contacts hashing (on the device)', () => {
  it('normalises e-mail addresses and drops anything else', () => {
    expect(normaliseEmail('  Ayse.Kaya@Example.COM ')).toBe('ayse.kaya@example.com');
    expect(normaliseEmail('+90 555 000 00 00')).toBeNull();
    expect(normaliseEmail('not an email')).toBeNull();
    expect(normaliseEmail(undefined)).toBeNull();
    expect(distinctEmails(['A@b.co', 'a@B.co ', null, 'x'])).toEqual(['a@b.co']);
  });

  it('uploads the prefix of the unsalted hash and the salted hash — never the address', async () => {
    const [entry] = await hashContactEmails(['Ayse@Example.com'], params, sha);
    const h0 = createHash('sha256').update('ayse@example.com', 'utf8').digest('hex');
    expect(entry).toEqual({
      p: h0.slice(0, 3),
      h: createHash('sha256').update(`${params.salt}:email:${h0}`, 'utf8').digest('hex'),
    });
    expect(JSON.stringify(entry)).not.toContain('ayse');
    // The reference itself: FIPS 180-2 test vector SHA-256("abc").
    expect(await sha('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('a different salt gives a different upload for the same address', async () => {
    const [a] = await hashContactEmails(['ayse@example.com'], params, sha);
    const [b] = await hashContactEmails(['ayse@example.com'], { ...params, salt: 'b3RoZXI' }, sha);
    expect(a?.p).toBe(b?.p);
    expect(a?.h).not.toBe(b?.h);
  });

  it('deduplicates and caps at maxHashes', async () => {
    const many = Array.from({ length: 12 }, (_, i) => `user${i}@example.com`);
    const hashes = await hashContactEmails([...many, 'USER0@example.com'], { ...params, maxHashes: 10 }, sha);
    expect(hashes).toHaveLength(10);
    expect(new Set(hashes.map((x) => x.h)).size).toBe(10);
  });
});
