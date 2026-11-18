import '../../global.css';
import '@/i18n';
import '@/theme/interop';

// Per-weight imports so only the embedded weights ship (full TTFs include the latin-ext glyphs).
import { CormorantGaramond_500Medium } from '@expo-google-fonts/cormorant-garamond/500Medium';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond/600SemiBold';
import { Jost_400Regular } from '@expo-google-fonts/jost/400Regular';
import { Jost_500Medium } from '@expo-google-fonts/jost/500Medium';
import { Roboto_500Medium } from '@expo-google-fonts/roboto/500Medium';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';

import { useOnboardingStatus } from '@/auth/onboarding';
import { AnimatedSplash } from '@/components/brand/AnimatedSplash';
import { sessionStore, useSession } from '@/auth/session';
import { ConflictHost } from '@/sync/ConflictHost';
import { wireNetworkAndFocus } from '@/sync/network';
import { QueryProvider } from '@/sync/QueryProvider';
import { palettes } from '@/theme/tokens';

void SplashScreen.preventAutoHideAsync();
wireNetworkAndFocus();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    CormorantGaramond_500Medium,
    CormorantGaramond_600SemiBold,
    Jost_400Regular,
    Jost_500Medium,
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
  const onboarded = signedIn && onboarding === 'done';
  /** Where a guarded route sends the user right now. */
  const home = !signedIn ? '/welcome' : onboarded ? '/' : '/style';

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

        <Stack.Protected guard={signedIn && !onboarded} redirectTo={home}>
          <Stack.Screen name="(onboarding)/style" />
          <Stack.Screen name="(onboarding)/body" />
          <Stack.Screen name="(onboarding)/first-items" />
        </Stack.Protected>

        <Stack.Protected guard={onboarded} redirectTo={home}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="plan/week" />
          <Stack.Screen name="edit/[id]" />
          <Stack.Screen name="calendar" />
          <Stack.Screen name="item/[id]" />
          <Stack.Screen name="item/bulk" />
          <Stack.Screen name="look/new" />
          <Stack.Screen name="look/[id]" />
          <Stack.Screen name="trip/[id]" />
          <Stack.Screen name="stylist/[jobId]" />
          <Stack.Screen name="palette" />
          <Stack.Screen name="shop/index" />
          <Stack.Screen name="shop/product/[id]" />
          <Stack.Screen name="shop/builder" />
          <Stack.Screen name="cart" />
          <Stack.Screen name="friends/feed" />
          <Stack.Screen name="friends/find" />
          <Stack.Screen name="u/[handle]" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="subscription" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="delete-account" />
          <Stack.Screen name="tryon/[jobId]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="dev/components" />
        </Stack.Protected>

        <Stack.Protected guard={signedIn} redirectTo={home}>
          {/* 05 — after onboarding (04b) and from locked features. */}
          <Stack.Screen name="paywall" options={{ presentation: 'modal', gestureEnabled: false }} />
          {/* 12 Parça ekle — also the camera shortcut on onboarding 04b. */}
          <Stack.Screen name="item/add" options={{ presentation: 'fullScreenModal' }} />
        </Stack.Protected>

        {/* Password reset deep link (droplet://reset-password?token=…), signed in or not. */}
        <Stack.Screen name="(auth)/reset-password" />
      </Stack>
      <ConflictHost />
      {splashDone ? null : <AnimatedSplash onDone={finishSplash} />}
    </QueryProvider>
  );
}
