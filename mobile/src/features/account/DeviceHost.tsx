import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { syncPushRegistration } from '@/notify/push';
import { notificationRoute } from '@/notify/routes';

import { registerDevice } from './device';

let handlerSet = false;
/** Last notification already routed (a cold-start response must not open twice). */
let lastRouted: string | null = null;

function openFrom(response: Notifications.NotificationResponse | null) {
  if (!response) return;
  const id = response.notification.request.identifier;
  if (id === lastRouted) return;
  lastRouted = id;
  const route = notificationRoute(response.notification.request.content.data as Record<string, unknown> | undefined);
  if (route) router.push(route as Href);
}

/**
 * Registers this installation for the signed-in user once per app start (mounted in `AppHosts`,
 * keyed by user) — with its push token when push is already allowed (the prompt itself is shown after
 * onboarding or when a notification toggle is switched on). Keeps the token fresh (the OS can rotate
 * it) and turns notification taps into deep links. Best effort: offline or a full device list never
 * bothers the user; the next start tries again.
 */
export function DeviceHost() {
  useEffect(() => {
    void syncPushRegistration({ ask: false });
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
