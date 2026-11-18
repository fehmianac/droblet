import { useMutation } from '@tanstack/react-query';

import { track } from '@/analytics/track';
import { onboardingStore } from '@/auth/onboarding';
import { sessionStore } from '@/auth/session';

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

/**
 * Auth calls are interactive and online-only (they create the session the queue depends on),
 * so they use plain mutations rather than the persisted tenant write queue.
 */
async function signIn(path: string, body: unknown, onboarding: 'pending' | 'done'): Promise<AuthResponse> {
  const res = await apiRequest<AuthResponse>(path, { method: 'POST', body, auth: false });
  // Set onboarding progress before the session flips, so navigation guards pick the right stack.
  if (onboarding === 'done') await onboardingStore.markDone(res.user.id);
  else await onboardingStore.load(res.user.id);
  if (onboarding === 'pending' && path === 'v1/auth/register') {
    await onboardingStore.markPending(res.user.id);
    track('signup_step', { step: 'account_created', method: 'email' });
  }
  await sessionStore.setFromAuthResponse(res);
  return res;
}

export function useRegister() {
  return useMutation({ mutationFn: (body: RegisterRequest) => signIn('v1/auth/register', body, 'pending') });
}

export function useLogin() {
  return useMutation({ mutationFn: (body: LoginRequest) => signIn('v1/auth/login', body, 'done') });
}

export function useAppleSignIn() {
  return useMutation({ mutationFn: (body: AppleAuthRequest) => signIn('v1/auth/apple', body, 'pending') });
}

export function useGoogleSignIn() {
  return useMutation({ mutationFn: (body: GoogleAuthRequest) => signIn('v1/auth/google', body, 'pending') });
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
    try {
      await apiRequest<void>('v1/auth/logout', { method: 'POST', body });
    } catch {
      // Offline or already revoked: local sign-out still proceeds; the token expires server-side.
    }
  }
  await sessionStore.clear();
}
