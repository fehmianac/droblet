import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useOnboardingStatus } from '@/auth/onboarding';
import { askForPush, pushAskPending, syncPushRegistration } from '@/notify/push';
import { routeForPush } from '@/notify/routes';

import { registerDevice } from './device';

let handlerSet = false;
/** Last notification already routed (a cold-start response must not open twice). */
let lastRouted: string | null = null;

function openFrom(response: Notifications.NotificationResponse | null) {
  if (!response) return;
  const id = response.notification.request.identifier;
  if (id === lastRouted) return;
  lastRouted = id;
  router.push(routeForPush(response.notification.request.content.data as Record<string, unknown> | undefined));
}

/**
 * App start for a user onboarded before 04d Bildirim izni existed (canvas 19) and never asked on this
 * install: the system prompt once (owner's earlier decision: they are asked at app start). Everyone else
 * only registers an already granted permission silently — new users are asked in onboarding (04d), and a
 * notification toggle switched on asks again while the OS still can.
 */
export async function startupPushRegistration(onboarded: boolean): Promise<void> {
  if (onboarded && (await pushAskPending())) {
    await askForPush('app_start');
    return;
  }
  await syncPushRegistration({ ask: false });
}

/**
 * Registers this installation for the signed-in user once per app start (mounted in `AppHosts`, keyed by
 * user), once the onboarding status is known. No cold permission prompt at launch: the ask lives in
 * onboarding (04d); only legacy users get the one-time app-start ask (`startupPushRegistration`). Keeps
 * the token fresh (the OS can rotate it) and turns notification taps into deep links. Best effort:
 * offline or a full device list never bothers the user; the next start tries again.
 */
export function DeviceHost({ userId }: { userId: string }) {
  const onboarding = useOnboardingStatus(userId);
  const ran = useRef(false);

  // Once per mount (= app start / sign-in), after the stored onboarding status has loaded. Finishing
  // onboarding later in the same session does not run it again (04d has asked by then).
  useEffect(() => {
    if (onboarding === 'unknown' || ran.current) return;
    ran.current = true;
    void startupPushRegistration(onboarding === 'done').catch(() => undefined);
  }, [onboarding]);

  useEffect(() => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;

    if (!handlerSet) {
      handlerSet = true;
      Notifications.setNotificationHandler({
        handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
      });
    }
    const tokenSubscription = Notifications.addPushTokenListener((token) => {
      if (typeof token.data === 'string') void registerDevice(token.data, Platform.OS === 'ios' ? 'apns' : 'fcm').catch(() => undefined);
    });
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(openFrom);
    // The tap that launched the app (cold start).
    try {
      openFrom(Notifications.getLastNotificationResponse());
    } catch {
      // not available on this platform / build
    }
    return () => {
      tokenSubscription.remove();
      responseSubscription.remove();
    };
  }, []);
  return null;
}
