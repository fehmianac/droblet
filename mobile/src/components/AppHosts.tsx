import { AnalyticsHost } from '@/analytics/AnalyticsHost';
import { CreditSheetHost } from '@/features/credits/CreditPackSheet';
import { InviteHost } from '@/features/social/InviteHost';

/**
 * App-wide hosts that live inside the QueryProvider next to the navigator: analytics batching,
 * the pending-invite applier and the 05b extra-credit sheet (signed-in users only).
 */
export function AppHosts({ userId }: { userId: string | null }) {
  return (
    <>
      <AnalyticsHost userId={userId} />
      <InviteHost userId={userId} />
      {userId ? <CreditSheetHost /> : null}
    </>
  );
}
