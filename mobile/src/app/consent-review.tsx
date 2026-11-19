import { router } from 'expo-router';

import { useSession } from '@/auth/session';
import { Screen } from '@/components/ui/Screen';
import { ConsentReview } from '@/features/consent/ConsentReview';

/**
 * The all-in-one consent screen for an account that already finished onboarding but has consents it never
 * answered (e.g. the new `facePhotoTryOn`): shown once on the next app open by `ConsentReviewHost`.
 */
export default function ConsentReviewScreen() {
  const session = useSession();
  const userId = session.status === 'signedIn' ? session.user.id : null;
  return (
    <Screen>
      <ConsentReview mode="update" userId={userId} onDone={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
    </Screen>
  );
}
