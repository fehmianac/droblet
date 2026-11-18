import { ulid } from '@/lib/ids';

export type ClientMutationMeta = {
  /** Generated ONCE when the user acts; persisted with the queued mutation and reused on every retry. */
  clientMutationId: string;
  /** Device time of the user's action (not send time), UTC ISO-8601. */
  occurredAt: string;
};

export function newClientMutation(): ClientMutationMeta {
  return { clientMutationId: ulid(), occurredAt: new Date().toISOString() };
}
