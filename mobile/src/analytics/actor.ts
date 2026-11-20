import { CryptoDigestAlgorithm, CryptoEncoding, digestStringAsync } from 'expo-crypto';

export type Sha256Hex = (input: string) => Promise<string>;

const sha256Hex: Sha256Hex = (input) => digestStringAsync(CryptoDigestAlgorithm.SHA256, input, { encoding: CryptoEncoding.HEX });

/**
 * The pseudonymous analytics actor of an account — the SAME value the server stores with every
 * first-party event (`AnalyticsRules.Actor`: the first 32 hex chars of SHA-256("droblet-analytics:" + tenantId)),
 * so Firebase's user id and our own funnel join without either holding an e-mail, a name or the raw account id.
 */
export async function analyticsActor(tenantId: string, hash: Sha256Hex = sha256Hex): Promise<string> {
  return (await hash(`droblet-analytics:${tenantId}`)).toLowerCase().slice(0, 32);
}
