import { mapIncomingLink } from '@/features/social/deepLinks';
import { inviteStore } from '@/features/social/inviteStore';

/**
 * Rewrites incoming system links (`droplet://…`, `https://droblet.alatech.co/…`) to app routes and
 * keeps the invite code a shared look / profile / invite link carries until the user has an account
 * (applied by `InviteHost`). Route guards still decide what a signed-out user sees.
 */
/**
 * The sign-in providers hand the result back to the app through a URL (Google on iOS:
 * `com.googleusercontent.apps.<id>:/oauthredirect?code=…`). expo-auth-session reads it; the router must not treat it as
 * a screen — opening "/oauthredirect" crashed into the error screen right after a successful Google sign-in.
 */
export function isAuthRedirect(path: string): boolean {
  return /^com\.googleusercontent\.apps\./i.test(path) || /(^|[/:])oauthredirect(\b|$)/i.test(path) || /^[a-z0-9.-]+:\/oauth2redirect/i.test(path);
}

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (isAuthRedirect(path)) return '/';
  try {
    const mapped = mapIncomingLink(path);
    if (mapped.inviteCode) void inviteStore.capture(mapped.inviteCode);
    return mapped.path;
  } catch {
    return path;
  }
}
