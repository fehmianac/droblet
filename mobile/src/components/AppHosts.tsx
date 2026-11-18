import { AnalyticsHost } from '@/analytics/AnalyticsHost';
import { LanguageSyncHost } from '@/features/account/LanguageSyncHost';
import { CreditSheetHost } from '@/features/credits/CreditPackSheet';
import { InviteHost } from '@/features/social/InviteHost';

/**
 * App-wide hosts that live inside the QueryProvider next to the navigator: analytics batching,
 * the pending-invite applier, the 05b extra-credit sheet and the profile-language sync (signed-in users only).
 */
export function AppHosts({ userId }: { userId: string | null }) {
  return (
    <>
      <AnalyticsHost userId={userId} />
      <InviteHost userId={userId} />
      {userId ? <CreditSheetHost /> : null}
      {/* Keyed by user: a new sign-in re-checks the profile language against this phone's. */}
      {userId ? <LanguageSyncHost key={userId} /> : null}
    </>
  );
}
