import { skipToken, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import Constants from 'expo-constants';
import { useSegments } from 'expo-router';
import { AppState, Platform } from 'react-native';

import { apiRequest } from '@/api/client';
import type { MyPhotos, ProfileStats } from '@/api/contracts/account';
import type { EventBatchRequest } from '@/api/contracts/analytics';
import { toEventBatchWire, type EventBatchResponseWire } from '@/api/wire/analytics';
import type { StyleProfile } from '@/api/contracts';
import type { toEntitlement } from '@/api/wire/core';
import { useOnboardingStatus } from '@/auth/onboarding';
import { useSession } from '@/auth/session';
import { accountKeys } from '@/features/account/queries';
import { useTeenRules } from '@/features/teen/store';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { queryKeys } from '@/sync/queryKeys';

import { analyticsActor } from './actor';
import { firebaseAgeGate, firebaseCollecting, setFirebaseAgeGate, setFirebaseUserId, setFirebaseUserProperties, subscribeFirebaseAgeGate } from './firebase';
import { toFirebaseUserProperties, wardrobeSizeBucket } from './firebaseEvents';
import { useProductAnalyticsEnabled } from './preference';
import { bindAnalyticsSink, flushAnalytics, trackScreen } from './track';

export const analyticsMutationKey = ['tenant', 'event', 'batch'] as const;

/**
 * `POST v1/tenant/event` — the batch is converted to the server's vocabulary first (`wire/analytics`);
 * a batch with nothing the server takes from the client is not sent. Individually rejected events
 * (`rejected[]`) are dropped: the API says never to retry them.
 */
export async function sendEventBatch(batch: EventBatchRequest): Promise<EventBatchResponseWire> {
  const body = toEventBatchWire(batch.events, Platform.OS === 'android' ? 'android' : 'ios', Constants.expoConfig?.version ?? '0.0.0');
  if (!body) return { accepted: 0, rejected: [] };
  return apiRequest<EventBatchResponseWire>('v1/tenant/event', { method: 'POST', body });
}

/**
 * Analytics batches use their own scope: they queue and retry like every other write, but a slow or
 * failing batch never holds back the user's own writes.
 */
export function registerAnalyticsMutation(client: QueryClient): void {
  client.setMutationDefaults(analyticsMutationKey, {
    scope: { id: 'analytics' },
    mutationFn: sendEventBatch,
  });
}

/** GA4 `screen_view` on every route change, named by the route pattern (`item/[id]`), never by ids. */
function ScreenViews() {
  const segments = useSegments();
  const screen = segments.join('/');
  useEffect(() => {
    trackScreen(screen ? screen.split('/') : []);
  }, [screen]);
  return null;
}

/** Reads a query's cached data without ever fetching it (the screens that need it do). */
function useCached<T>(queryKey: readonly unknown[]): T | undefined {
  return useQuery<T>({ queryKey, queryFn: skipToken }).data;
}

/**
 * Firebase user id (the pseudonymous actor hash, = the server's) and the GA4 user properties. Mounted only
 * while Firebase collects; reads cached data only — it never adds a request.
 */
function FirebaseUser({ userId }: { userId: string }) {
  const session = useSession();
  const tenantId = session.status === 'signedIn' ? (session.user.tenantId ?? null) : null;
  const onboarding = useOnboardingStatus(userId);
  const language = useAppLanguage();
  const entitlement = useCached<ReturnType<typeof toEntitlement>>(queryKeys.entitlement);
  const photos = useCached<MyPhotos>(accountKeys.photos);
  const stats = useCached<ProfileStats>(accountKeys.stats);
  const styleProfile = useCached<StyleProfile | null>(queryKeys.styleProfile);

  useEffect(() => {
    if (!tenantId) return;
    let live = true;
    void analyticsActor(tenantId)
      .then((actor) => live && setFirebaseUserId(actor))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [tenantId]);

  const plan = entitlement ? (entitlement.tier === 'member' ? 'premium' : 'free') : null;
  const onboardingDone = onboarding === 'unknown' ? null : onboarding === 'done';
  const hasBody = photos ? photos.body.length > 0 : null;
  const hasFace = photos ? photos.face !== null : null;
  const bucket = wardrobeSizeBucket(stats?.itemCount);
  const segment = styleProfile ? (styleProfile.segment === 'men' ? 'men' : 'women') : null;
  useEffect(() => {
    if (!firebaseCollecting()) return;
    setFirebaseUserProperties(
      toFirebaseUserProperties({
        plan,
        app_language: language,
        onboarding_done: onboardingDone,
        has_body_photo: hasBody,
        has_face_photo: hasFace,
        wardrobe_size_bucket: bucket,
        segment,
      }),
    );
  }, [plan, language, onboardingDone, hasBody, hasFace, bucket, segment]);

  useEffect(() => () => setFirebaseUserId(null), []);
  return null;
}

/**
 * Connects `track()` to the signed-in user's persisted mutation queue and flushes when the app
 * goes to the background; reports screen views and, while product analytics is on, the Firebase
 * user id / properties. Rendered inside the QueryProvider; the first-party sink does nothing while signed out.
 */
export function AnalyticsHost({ userId }: { userId: string | null }) {
  const client = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    bindAnalyticsSink((batch) => {
      void client
        .getMutationCache()
        .build(client, { mutationKey: analyticsMutationKey })
        .execute(batch)
        .catch(() => undefined); // Analytics never surfaces an error to the user.
    });
    const subscription = AppState.addEventListener('change', (status) => {
      if (status !== 'active') flushAnalytics();
    });
    return () => {
      subscription.remove();
      bindAnalyticsSink(null);
    };
  }, [client, userId]);

  // Canvas 18: a teen account never reports to Firebase (no events, no user id, no user properties). The gate is
  // applied before the Firebase user mounts, so its first effect already sees the right state.
  const teen = useTeenRules().hide.analytics;
  const gate = teen ? 'blocked' : 'open';
  useEffect(() => {
    setFirebaseAgeGate(gate);
  }, [gate]);
  const appliedGate = useSyncExternalStore(subscribeFirebaseAgeGate, firebaseAgeGate, firebaseAgeGate);

  const productAnalytics = useProductAnalyticsEnabled();
  return (
    <>
      <ScreenViews />
      {userId && productAnalytics && appliedGate === 'open' && !teen ? <FirebaseUser key={userId} userId={userId} /> : null}
    </>
  );
}
