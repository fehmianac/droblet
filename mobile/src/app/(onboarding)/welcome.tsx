import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { track } from '@/analytics/track';
import { Logo } from '@/components/brand/Logo';
import { LegalConsent } from '@/components/LegalLinks';
import { Button } from '@/components/ui/Button';
import { Silhouette } from '@/components/ui/Silhouette';
import { Text } from '@/components/ui/Text';
import { placeholderTones, type PlaceholderTone } from '@/theme/tokens';
import { useThemeColors } from '@/theme/useThemeColors';

/** The four collage tiles of `Main.dc.html`, row by row. */
const TILES: { tone: PlaceholderTone; figure: 'ink' | 'cream' }[] = [
  { tone: 'clay', figure: 'ink' },
  { tone: 'dark', figure: 'cream' },
  { tone: 'stage', figure: 'ink' },
  { tone: 'taupe', figure: 'ink' },
];

function Tile({ tone, figure }: (typeof TILES)[number]) {
  return (
    <View className="h-[410px] flex-1 items-center justify-center overflow-hidden rounded-tile" style={{ backgroundColor: placeholderTones[tone] }}>
      <Silhouette height={254} tone={figure} opacity={0.16} />
    </View>
  );
}

/**
 * 01 Hoş geldin — full-bleed 2×2 look collage behind a cream fade; at the bottom the eyebrow, the
 * horizontal logo lock-up, the promise, two entry points and the legal line.
 */
export default function WelcomeScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-cream">
      <View style={StyleSheet.absoluteFill} className="gap-1.5 p-1.5" accessible={false} importantForAccessibility="no-hide-descendants">
        <View className="flex-row gap-1.5">
          {TILES.slice(0, 2).map((tile) => (
            <Tile key={tile.tone} {...tile} />
          ))}
        </View>
        <View className="flex-row gap-1.5">
          {TILES.slice(2).map((tile) => (
            <Tile key={tile.tone} {...tile} />
          ))}
        </View>
      </View>
      <LinearGradient
        colors={[colors.creamClear, colors.creamVeil, colors.cream]}
        locations={[0.3, 0.58, 0.7]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View className="absolute bottom-0 left-0 right-0 gap-[18px] px-6" style={{ paddingBottom: Math.max(insets.bottom, 16) + 24 }}>
        <Text variant="eyebrow">{t('welcome.eyebrow')}</Text>
        <Logo size="hero" />
        <Text variant="body" className="max-w-[300px] text-[17px] leading-[25.5px]">
          {t('welcome.promise')}
        </Text>
        <View className="mt-2 gap-2.5">
          <Button
            label={t('welcome.start')}
            testID="welcome.start"
            onPress={() => {
              track('signup_step', { step: 'welcome' });
              router.push({ pathname: '/start', params: { mode: 'register' } });
            }}
          />
          <Button
            variant="secondary"
            size="lg"
            label={t('welcome.haveAccount')}
            testID="welcome.login"
            onPress={() => router.push({ pathname: '/start', params: { mode: 'login' } })}
          />
        </View>
        <LegalConsent />
      </View>
    </View>
  );
}
