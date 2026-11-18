import { mapIncomingLink } from '@/features/social/deepLinks';
import { inviteStore } from '@/features/social/inviteStore';

/**
 * Rewrites incoming system links (`droplet://…`, `https://droplet.alatech.co/…`) to app routes and
 * keeps the invite code a shared look / profile / invite link carries until the user has an account
 * (applied by `InviteHost`). Route guards still decide what a signed-out user sees.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const mapped = mapIncomingLink(path);
    if (mapped.inviteCode) void inviteStore.capture(mapped.inviteCode);
    return mapped.path;
  } catch {
    return path;
  }
}
