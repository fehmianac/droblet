import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { track } from '@/analytics/track';
import { Logo } from '@/components/brand/Logo';
import { LegalConsent } from '@/components/LegalLinks';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useAvailableSegments } from '@/features/segment/useAvailableSegments';
import { isCompactWelcome, WELCOME_HEROES, welcomeHero } from '@/features/welcome/heroImage';
import { onPhotoTones } from '@/theme/tokens';

/** Share of the screen the photo covers before the ground takes over (canvas 640 / 844, SE 430 / 667). */
const PHOTO_SHARE = 640 / 844;
const PHOTO_SHARE_COMPACT = 430 / 667;

/** Where each photo is anchored horizontally when cover-cropped (canvas 20a–20d `object-position`). */
const FOCUS_X = { mixed: 0.5, group: 0.5, women: 0.42, men: 0.62 } as const;

/**
 * 01 Hoş geldin — canvas 20 · Karşılama, direction A (editorial photo). A bundled photo chosen from
 * `segments.available` (20a couple / 20b woman / 20c man, 20d group on SE-class phones) fades into a dark
 * ground; the cream lock-up sits top left, the headline, the value line, the two entry points and the
 * legal line at the bottom. Light status bar while this screen is focused.
 */
export default function WelcomeScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { segments, loading } = useAvailableSegments();
  const compact = isCompactWelcome(height);
  // Never wait for the config: the screen works at once; the photo fades in when the segments are known
  // (a failed request settles at once as women only). SE-class phones always show the group.
  const hero = loading && !compact ? null : welcomeHero(segments, height);
  const photoHeight = Math.round(height * (compact ? PHOTO_SHARE_COMPACT : PHOTO_SHARE));

  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('dark');
    }, []),
  );

  return (
    <View className="flex-1 bg-onPhoto-ground">
      <View style={[styles.photo, { height: photoHeight }]} accessible={false} importantForAccessibility="no-hide-descendants">
        {hero ? (
          <Image
            testID={`welcome.hero.${hero}`}
            source={WELCOME_HEROES[hero]}
            contentFit="cover"
            contentPosition={{ left: `${FOCUS_X[hero] * 100}%`, top: 0 }}
            transition={250}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <LinearGradient
          colors={[onPhotoTones.groundClear, onPhotoTones.groundMid, onPhotoTones.groundDeep, onPhotoTones.ground]}
          locations={[0.52, 0.74, 0.9, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      </View>
      <LinearGradient
        colors={[onPhotoTones.groundTop, onPhotoTones.groundClear]}
        style={[styles.topFade, { height: insets.top + 120 }]}
        pointerEvents="none"
      />

      <View className="absolute left-6" style={{ top: insets.top + 12 }}>
        <Logo size="header" tone="cream" />
      </View>

      <View className="absolute bottom-0 left-0 right-0 px-6" style={{ paddingBottom: Math.max(insets.bottom, 16) + 24 }}>
        <Text
          variant="display"
          tone="cream"
          accessibilityRole="header"
          testID="welcome.headline"
          className={`max-w-[330px] ${compact ? 'text-[32px] leading-[33px]' : 'text-[38px] leading-[39px]'} tracking-[-0.5px]`}
        >
          {t('welcome.headline')}
        </Text>
        {compact ? null : (
          <Text variant="body" tone="onPhoto" testID="welcome.value" className="mt-3 max-w-[320px] text-[15px] leading-[22px]">
            {t('welcome.value')}
          </Text>
        )}
        <View className="mt-6 gap-2.5">
          <Button
            variant="inverse"
            label={t('welcome.start')}
            testID="welcome.start"
            onPress={() => {
              track('signup_step', { step: 'welcome' });
              router.push({ pathname: '/start', params: { mode: 'register' } });
            }}
          />
          <Button
            variant="inverseOutline"
            size="lg"
            label={t('welcome.haveAccount')}
            testID="welcome.login"
            onPress={() => router.push({ pathname: '/start', params: { mode: 'login' } })}
          />
        </View>
        <View className="mt-3.5">
          <LegalConsent onPhoto />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  photo: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  topFade: { position: 'absolute', top: 0, left: 0, right: 0 },
});
