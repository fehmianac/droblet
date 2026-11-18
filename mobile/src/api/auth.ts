import { useMutation } from '@tanstack/react-query';

import { track } from '@/analytics/track';
import { onboardingStore } from '@/auth/onboarding';
import { sessionStore } from '@/auth/session';
import { peekDeviceId } from '@/features/account/device';

import { apiRequest } from './client';
import type {
  AppleAuthRequest,
  AuthResponse,
  ForgotPasswordRequest,
  GoogleAuthRequest,
  LoginRequest,
  LogoutRequest,
  RegisterRequest,
  ResetPasswordRequest,
} from './contracts';
import { ApiError } from './errors';
import type { AppleAuthRequestWire, ProfileWire } from './wire/core';

type Method = 'email' | 'apple' | 'google';

/**
 * Does this account still have to go through onboarding (03 → 04 → 04b)?
 * The rule is the same for every way of signing in (e-mail, Apple, Google): a new account
 * (`isNewUser`) or an account without a style profile runs onboarding. When the server cannot be
 * asked (offline right after the token arrived) the device's own record decides.
 */
async function needsOnboarding(res: AuthResponse): Promise<boolean | null> {
  if (res.isNewUser) return true;
  try {
    await apiRequest<unknown>('v1/tenant/style-profile', { accessToken: res.accessToken });
    return false;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return true;
    return null;
  }
}

async function readProfile(res: AuthResponse): Promise<ProfileWire | null> {
  try {
    return await apiRequest<ProfileWire>('v1/tenant/profile', { accessToken: res.accessToken });
  } catch {
    return null;
  }
}

/**
 * Auth calls are interactive and online-only (they create the session the queue depends on),
 * so they use plain mutations rather than the persisted tenant write queue.
 */
async function signIn(
  path: string,
  body: unknown,
  method: Method,
  known: { name?: string; email?: string },
): Promise<AuthResponse> {
  const res = await apiRequest<AuthResponse>(path, { method: 'POST', body, auth: false });

  // Onboarding progress is decided before the session flips, so navigation guards pick the right stack.
  const [pending, profile] = await Promise.all([needsOnboarding(res), res.isNewUser ? null : readProfile(res)]);
  if (pending === true) await onboardingStore.markPending(res.userId);
  else if (pending === false) await onboardingStore.markDone(res.userId);
  else await onboardingStore.load(res.userId);

  if (res.isNewUser) track('signup_step', { step: 'account_created', method });

  await sessionStore.setFromAuthResponse(res, {
    name: known.name ?? profile?.displayName ?? undefined,
    email: known.email ?? profile?.email ?? undefined,
  });
  return res;
}

export function useRegister() {
  return useMutation({
    mutationFn: (body: RegisterRequest) => signIn('v1/auth/register', body, 'email', { name: body.name, email: body.email }),
  });
}

export function useLogin() {
  return useMutation({
    mutationFn: (body: LoginRequest) => signIn('v1/auth/login', body, 'email', { email: body.email }),
  });
}

export function useAppleSignIn() {
  return useMutation({
    mutationFn: ({ identityToken, nonce, givenName, familyName, authorizationCode }: AppleAuthRequest) => {
      const body: AppleAuthRequestWire = { identityToken, nonce };
      if (authorizationCode) body.authorizationCode = authorizationCode;
      if (givenName || familyName) body.fullName = { givenName: givenName ?? null, familyName: familyName ?? null };
      const name = [givenName, familyName].filter(Boolean).join(' ');
      return signIn('v1/auth/apple', body, 'apple', name ? { name } : {});
    },
  });
}

export function useGoogleSignIn() {
  return useMutation({
    mutationFn: (body: GoogleAuthRequest) => signIn('v1/auth/google', body, 'google', body.name ? { name: body.name } : {}),
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (body: ForgotPasswordRequest) =>
      apiRequest<void>('v1/auth/password/forgot', { method: 'POST', body, auth: false }),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (body: ResetPasswordRequest) =>
      apiRequest<void>('v1/auth/password/reset', { method: 'POST', body, auth: false }),
  });
}

/** Revokes the refresh token server-side (best effort) and clears local tokens. */
export async function logout(): Promise<void> {
  const tokens = sessionStore.getTokens();
  if (tokens) {
    const body: LogoutRequest = { refreshToken: tokens.refreshToken };
    // With the device id the server also removes this installation's push registration.
    const deviceId = await peekDeviceId();
    if (deviceId) body.deviceId = deviceId;
    try {
      await apiRequest<void>('v1/auth/logout', { method: 'POST', body });
    } catch {
      // Offline or already revoked: local sign-out still proceeds; the token expires server-side.
    }
  }
  await sessionStore.clear();
}
