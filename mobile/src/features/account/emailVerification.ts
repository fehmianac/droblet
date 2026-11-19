import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import { fromSource } from '@/api/dataSource';
import { ApiError } from '@/api/errors';
import { accountFixtures } from '@/fixtures/account';

import { accountKeys } from './queries';

/**
 * E-mail verification (docs/api/verification-export.md §1): `POST v1/auth/email/verify { code | token }` and
 * `POST v1/auth/email/resend`. The code needs the signed-in session; the link token works signed out (the request is
 * then sent without a token). Nothing in the app is blocked while unverified.
 */
export const VERIFY_CODE_LENGTH = 6;
/** The server allows one resend per minute: the button counts down from this. */
export const RESEND_COOLDOWN_SECONDS = 60;

export type VerifyErrorKind = 'invalid' | 'expired' | 'tooMany' | 'network';

/** The sentence key of a failed verify / resend. */
export function verifyErrorKind(error: unknown): VerifyErrorKind {
  if (!(error instanceof ApiError) || error.kind === 'network') return 'network';
  if (error.status === 429 || error.code === 'too_many_attempts') return 'tooMany';
  if (error.code === 'verification_expired') return 'expired';
  return 'invalid';
}

/** Keeps the digits only, at most six (paste of "123 456" or a whole e-mail line works). */
export function cleanCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, VERIFY_CODE_LENGTH);
}

type VerifyInput = { code: string } | { token: string };

export function useVerifyEmail() {
  const client = useQueryClient();
  return useMutation<void, unknown, VerifyInput>({
    mutationFn: (input) =>
      fromSource(
        'account',
        () => accountFixtures.verifyEmail('code' in input ? input.code : null),
        async () => {
          await apiRequest<{ emailVerified: boolean }>('v1/auth/email/verify', {
            method: 'POST',
            body: input,
            // The link may be opened signed out (or on another account): only the code needs the session.
            auth: 'code' in input,
          });
        },
      ),
    onSuccess: () => {
      client.setQueryData(accountKeys.profile, (prev: { emailVerified?: boolean } | undefined) => (prev ? { ...prev, emailVerified: true } : prev));
      void client.invalidateQueries({ queryKey: accountKeys.profile });
    },
  });
}

export function useResendVerification() {
  return useMutation<void, unknown, void>({
    mutationFn: () =>
      fromSource(
        'account',
        () => accountFixtures.resendVerification(),
        async () => {
          try {
            await apiRequest<void>('v1/auth/email/resend', { method: 'POST' });
          } catch (e) {
            // Verified meanwhile (the link on another device): nothing to send.
            if (e instanceof ApiError && e.code === 'email_already_verified') return;
            throw e;
          }
        },
      ),
  });
}
