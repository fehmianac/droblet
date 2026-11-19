import '../../global.css';
import '@/i18n';
import '@/theme/interop';

// Per-weight imports so only the embedded weights ship (full TTFs include the latin-ext glyphs).
import { CormorantGaramond_500Medium } from '@expo-google-fonts/cormorant-garamond/500Medium';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond/600SemiBold';
import { Jost_400Regular } from '@expo-google-fonts/jost/400Regular';
import { Jost_500Medium } from '@expo-google-fonts/jost/500Medium';
import { Jost_600SemiBold } from '@expo-google-fonts/jost/600SemiBold';
import { Roboto_500Medium } from '@expo-google-fonts/roboto/500Medium';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';

import { useOnboardingStatus } from '@/auth/onboarding';
import { AnimatedSplash } from '@/components/brand/AnimatedSplash';
import { sessionStore, useSession } from '@/auth/session';
import { AppHosts } from '@/components/AppHosts';
import { SyncPill } from '@/components/ui/SyncPill';
import { restoreLanguagePreference } from '@/i18n/preference';
import { ConflictHost } from '@/sync/ConflictHost';
import { wireNetworkAndFocus } from '@/sync/network';
import { QueryProvider } from '@/sync/QueryProvider';
import { palettes } from '@/theme/tokens';

void SplashScreen.preventAutoHideAsync();
wireNetworkAndFocus();
void restoreLanguagePreference();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    CormorantGaramond_500Medium,
    CormorantGaramond_600SemiBold,
    Jost_400Regular,
    Jost_500Medium,
    Jost_600SemiBold,
    Roboto_500Medium,
  });
  const session = useSession();
  const userId = session.status === 'signedIn' ? session.user.id : null;
  const onboarding = useOnboardingStatus(userId);

  useEffect(() => {
    void sessionStore.hydrate();
  }, []);

  const ready =
    (fontsLoaded || fontError !== null) &&
    session.status !== 'loading' &&
    (session.status === 'signedOut' || onboarding !== 'unknown');

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  // 00 Splash: the native (static) splash hands over to the animated one, once per cold start.
  const [splashDone, setSplashDone] = useState(false);
  const finishSplash = useCallback(() => setSplashDone(true), []);

  if (!ready) return null;

  const signedIn = session.status === 'signedIn';
  /** 18+ not confirmed (Apple / Google account): the confirmation comes before anything else. */
  const ageBlocked = signedIn && session.user.ageConfirmed === false;
  const allowed = signedIn && !ageBlocked;
  const onboarded = allowed && onboarding === 'done';
  /** Where a guarded route sends the user right now. */
  const home = !signedIn ? '/welcome' : ageBlocked ? '/age-confirm' : onboarded ? '/' : '/style';

  return (
    <QueryProvider userId={userId}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palettes.light.cream },
        }}
      >
        {/* Every guard redirects explicitly to the current home (welcome / onboarding / Bugün). */}
        <Stack.Protected guard={!signedIn} redirectTo={home}>
          <Stack.Screen name="(onboarding)/welcome" />
          <Stack.Screen name="(auth)/start" />
          <Stack.Screen name="(auth)/forgot-password" />
        </Stack.Protected>

        <Stack.Protected guard={ageBlocked} redirectTo={home}>
          <Stack.Screen name="age-confirm" options={{ gestureEnabled: false }} />
        </Stack.Protected>

        <Stack.Protected guard={allowed && !onboarded} redirectTo={home}>
          <Stack.Screen name="(onboarding)/style" />
          <Stack.Screen name="(onboarding)/consents" />
          <Stack.Screen name="(onboarding)/body" />
          <Stack.Screen name="(onboarding)/first-items" />
        </Stack.Protected>

        <Stack.Protected guard={onboarded} redirectTo={home}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="plan/week" />
          <Stack.Screen name="plan/report" />
          <Stack.Screen name="edit/[id]" />
          <Stack.Screen name="calendar" />
          <Stack.Screen name="item/[id]" />
          <Stack.Screen name="item/bulk" />
          <Stack.Screen name="item/detect" />
          <Stack.Screen name="item/library" />
          <Stack.Screen name="item/form" />
          <Stack.Screen name="look/new" />
          <Stack.Screen name="look/[id]" />
          <Stack.Screen name="trip/[id]" />
          <Stack.Screen name="trip/new" options={{ presentation: 'modal' }} />
          <Stack.Screen name="stylist/[jobId]" />
          <Stack.Screen name="palette" />
          <Stack.Screen name="shop/index" />
          <Stack.Screen name="shop/product/[id]" />
          <Stack.Screen name="shop/builder" />
          <Stack.Screen name="cart" />
          <Stack.Screen name="watchlist" />
          <Stack.Screen name="friends/feed" />
          <Stack.Screen name="friends/find" />
          <Stack.Screen name="friends/requests" />
          <Stack.Screen name="friends/followers" />
          <Stack.Screen name="friends/following" />
          <Stack.Screen name="friends/saved" />
          <Stack.Screen name="friends/blocked" />
          <Stack.Screen name="friends/contacts" />
          <Stack.Screen name="u/[handle]" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="edit-profile" />
          <Stack.Screen name="subscription" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="delete-account" />
          <Stack.Screen name="tryon/[jobId]" options={{ presentation: 'modal' }} />
          {/* Consents never answered (a new purpose): the all-in-one screen, once, on the next app open. */}
          <Stack.Screen name="consent-review" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
          <Stack.Screen name="dev/components" />
        </Stack.Protected>

        <Stack.Protected guard={allowed} redirectTo={home}>
          {/* 05 — after onboarding (04b) and from locked features. */}
          <Stack.Screen name="paywall" options={{ presentation: 'modal', gestureEnabled: false }} />
          {/* 12 Parça ekle — also the camera shortcut on onboarding 04b. */}
          <Stack.Screen name="item/add" options={{ presentation: 'fullScreenModal' }} />
        </Stack.Protected>

        {/* Password reset deep link (droplet://reset-password?token=…), signed in or not. */}
        <Stack.Screen name="(auth)/reset-password" />
      </Stack>
      <ConflictHost />
      {/* Floating offline / sync status under the header: overlaid, never pushes a screen's content. */}
      {signedIn ? <SyncPill /> : null}
      <AppHosts userId={userId} />
      {splashDone ? null : <AnimatedSplash onDone={finishSplash} />}
    </QueryProvider>
  );
}

/** Last resort for any screen without its own boundary: the error state instead of the app closing. */
export { ScreenErrorBoundary as ErrorBoundary } from '@/components/ScreenErrorBoundary';
