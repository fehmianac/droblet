import { AnalyticsHost } from '@/analytics/AnalyticsHost';
import { DeviceHost } from '@/features/account/DeviceHost';
import { AgeCheckHost } from '@/features/consent/AgeCheckHost';
import { ConsentReviewHost } from '@/features/consent/ConsentReviewHost';
import { ConsentHost } from '@/features/consent/ConsentSheet';
import { RequirementsHost } from '@/features/requirements/RequirementsHost';
import { LanguageSyncHost } from '@/features/account/LanguageSyncHost';
import { CreditSheetHost } from '@/features/credits/CreditPackSheet';
import { InviteHost } from '@/features/social/InviteHost';
import { PurchasePromptHost } from '@/features/store/PurchasePromptHost';
import { PurchaseHost } from '@/purchases/PurchaseHost';

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
      {userId ? <DeviceHost key={`device-${userId}`} /> : null}
      {/* "Gardıroba ekleyelim mi?" after a purchase on a brand site, on the next app open. */}
      {userId ? <PurchasePromptHost key={`purchase-${userId}`} /> : null}
      {/* StoreKit / Play Billing listener: verifies late or unfinished purchases with the server. */}
      {userId ? <PurchaseHost key={`iap-${userId}`} /> : null}
    </>
  );
}
