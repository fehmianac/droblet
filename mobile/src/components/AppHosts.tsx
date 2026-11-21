import { AnalyticsHost } from '@/analytics/AnalyticsHost';
import { DeviceHost } from '@/features/account/DeviceHost';
import { AgeCheckHost } from '@/features/consent/AgeCheckHost';
import { ConsentReviewHost } from '@/features/consent/ConsentReviewHost';
import { ConsentHost } from '@/features/consent/ConsentSheet';
import { RequirementsHost } from '@/features/requirements/RequirementsHost';
import { LanguageSyncHost } from '@/features/account/LanguageSyncHost';
import { CreditSheetHost } from '@/features/credits/CreditPackSheet';
import { InviteHost } from '@/features/social/InviteHost';
import { SegmentHost } from '@/features/segment/SegmentHost';
import { PurchasePromptHost } from '@/features/store/PurchasePromptHost';
import { PurchaseHost } from '@/purchases/PurchaseHost';
import { TeenGateHost } from '@/features/teen/gate';
import { useTeenRules } from '@/features/teen/store';

/**
 * App-wide hosts that live inside the QueryProvider next to the navigator: analytics batching,
 * the pending-invite applier, the 05b extra-credit sheet and the profile-language sync (signed-in users only).
 */
export function AppHosts({ userId }: { userId: string | null }) {
  // Canvas 18: invites, purchases and the credit-pack sheet do not exist for a teen.
  const teen = useTeenRules().isTeen;
  return (
    <>
      <AnalyticsHost userId={userId} />
      {/* Canvas 17: the user's segment ("reyon") for copy, choices, placeholders and catalogue queries. */}
      {userId ? <SegmentHost key={`segment-${userId}`} /> : null}
      {teen ? null : <InviteHost userId={userId} />}
      {userId && !teen ? <CreditSheetHost /> : null}
      {/* Canvas 18: the teen lock sheet and the 22t explainer of gated actions. */}
      {userId ? <TeenGateHost /> : null}
      {/* Just-in-time consent sheet: feature gates and 403 `consent_required` answers open it. */}
      {userId ? <ConsentHost /> : null}
      {/* Consents never answered (a new purpose): the all-in-one screen once on the next app open. */}
      {userId ? <ConsentReviewHost key={`consent-review-${userId}`} userId={userId} /> : null}
      {/* Canvas 11: the requirements sheet / stepper / "Hazır" of a gated action. */}
      {userId ? <RequirementsHost /> : null}
      {/* A session stored before the 18+ check: asks the profile once whether the age was confirmed. */}
      {userId ? <AgeCheckHost key={`age-${userId}`} /> : null}
      {/* Keyed by user: a new sign-in re-checks the profile language against this phone's. */}
      {userId ? <LanguageSyncHost key={userId} /> : null}
      {/* Registers this installation (`PUT v1/tenant/user/me/device`) once per sign-in / app start. */}
      {userId ? <DeviceHost key={`device-${userId}`} userId={userId} /> : null}
      {/* "Gardıroba ekleyelim mi?" after a purchase on a brand site, on the next app open. */}
      {userId && !teen ? <PurchasePromptHost key={`purchase-${userId}`} /> : null}
      {/* StoreKit / Play Billing listener: verifies late or unfinished purchases with the server. */}
      {userId && !teen ? <PurchaseHost key={`iap-${userId}`} /> : null}
    </>
  );
}
