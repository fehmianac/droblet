import { useMutation } from '@tanstack/react-query';

import { ageConfirmedOf } from '@/api/auth';
import { apiRequest } from '@/api/client';
import { fromSource } from '@/api/dataSource';
import type { ProfileWire } from '@/api/wire/core';
import { sessionStore } from '@/auth/session';

/**
 * 18+ (Terms §3, Privacy §17). E-mail sign-up sends `ageConfirmed: true` with the form; an Apple /
 * Google account confirms once on `/age-confirm` (`POST v1/tenant/profile/age-confirmation`, idempotent).
 * The fixture account is confirmed; tests drive the screen through the session flag.
 */
let fixtureConfirmedAt: string | null = '2026-11-19T09:00:00.000Z';

export function resetAgeFixtures(confirmed = true): void {
  fixtureConfirmedAt = confirmed ? '2026-11-19T09:00:00.000Z' : null;
}

/** Whether the signed-in account confirmed its age; undefined when the server cannot say. */
export async function readAgeConfirmed(): Promise<boolean | undefined> {
  return fromSource<boolean | undefined>(
    'consents',
    () => fixtureConfirmedAt !== null,
    async () => ageConfirmedOf(await apiRequest<ProfileWire>('v1/tenant/profile')),
  );
}

export function useConfirmAge() {
  return useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async () => {
      await fromSource<unknown>(
        'consents',
        () => {
          fixtureConfirmedAt ??= new Date().toISOString();
          return null;
        },
        () => apiRequest<ProfileWire>('v1/tenant/profile/age-confirmation', { method: 'POST' }),
      );
      await sessionStore.updateUser({ ageConfirmed: true });
    },
  });
}
