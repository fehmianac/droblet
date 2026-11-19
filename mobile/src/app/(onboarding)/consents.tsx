import { router } from 'expo-router';

import { track } from '@/analytics/track';
import { useSession } from '@/auth/session';
import { StepHeader } from '@/components/auth/StepHeader';
import { Screen } from '@/components/ui/Screen';
import { ConsentReview } from '@/features/consent/ConsentReview';

/**
 * Onboarding 2 / 4 — every explicit consent once, on one screen (owner decision 1), between 03 Stil profili
 * and 04 Beden ve fotoğraf. The just-in-time sheets remain only for a consent declined here.
 */
export default function OnboardingConsentsScreen() {
  const session = useSession();
  const userId = session.status === 'signedIn' ? session.user.id : null;
  return (
    <Screen>
      <ConsentReview
        mode="onboarding"
        userId={userId}
        header={<StepHeader step={2} total={4} />}
        onDone={() => {
          track('signup_step', { step: 'consents' });
          router.push('/body');
        }}
      />
    </Screen>
  );
}
