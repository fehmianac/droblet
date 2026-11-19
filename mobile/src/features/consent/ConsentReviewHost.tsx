import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { useOnboardingStatus } from '@/auth/onboarding';

import { useConsents } from './api';
import { CONSENT_REVIEW_DONE, consentReviewKey, needsConsentReview } from './ConsentReview';

/** Once per app run: a failed save never turns into a loop of screens. */
let shownThisRun = false;

/** Tests: allow the screen again. */
export function resetConsentReviewHost(): void {
  shownThisRun = false;
}

/**
 * Existing accounts (onboarding done) with a consent they never answered — e.g. the new `facePhotoTryOn` —
 * see the all-in-one consent screen once on the next app open. Not during onboarding (step 2 asks there),
 * not again after it was answered on this device (marker), not twice in one run.
 */
export function ConsentReviewHost({ userId }: { userId: string }) {
  const onboarding = useOnboardingStatus(userId);
  const consents = useConsents();
  const [marker, setMarker] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void AsyncStorage.getItem(consentReviewKey(userId)).then((value) => alive && setMarker(value));
    return () => {
      alive = false;
    };
  }, [userId]);

  const due = onboarding === 'done' && marker !== undefined && marker !== CONSENT_REVIEW_DONE && needsConsentReview(consents.data);
  useEffect(() => {
    if (!due || shownThisRun) return;
    shownThisRun = true;
    router.push('/consent-review');
  }, [due]);

  return null;
}
