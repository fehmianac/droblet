import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { LegalConsent } from '@/components/LegalLinks';
import { Button } from '@/components/ui/Button';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useThemeColors } from '@/theme/useThemeColors';

function Tile({ caption }: { caption?: string }) {
  return (
    <View className="flex-1">
      <PlaceholderImage className="aspect-[4/5] w-full rounded-image-lg" />
      {caption ? (
        <View className="absolute bottom-3 left-3 rounded-pill bg-paper px-2.5 py-1">
          <Text variant="caption">{caption}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** 01 Hoş geldin — 2×2 look collage with a cream fade, promise, two entry points, legal links. */
export default function WelcomeScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  return (
    <Screen bottom>
      <ScrollView contentContainerClassName="flex-grow px-gutter pb-6" bounces={false}>
        <View className="pt-4">
          <View className="flex-row gap-3">
            <Tile caption={t('welcome.tileWardrobe')} />
            <Tile caption={t('welcome.tileStylist')} />
          </View>
          <View className="mt-3 flex-row gap-3">
            <Tile caption={t('welcome.tilePacking')} />
            <Tile />
          </View>
          <LinearGradient
            colors={[colors.creamClear, colors.cream]}
            className="absolute bottom-0 left-0 right-0 h-32"
            pointerEvents="none"
          />
        </View>

        <View className="flex-1 justify-end gap-4 pt-2">
          <Text variant="display" className="text-center">
            {t('welcome.brand')}
          </Text>
          <Text variant="body" tone="muted" className="text-center">
            {t('welcome.promise')}
          </Text>
          <View className="mt-4 gap-2">
            <Button label={t('welcome.start')} onPress={() => router.push({ pathname: '/start', params: { mode: 'register' } })} />
            <Button
              variant="text"
              label={t('welcome.haveAccount')}
              onPress={() => router.push({ pathname: '/start', params: { mode: 'login' } })}
            />
          </View>
          <LegalConsent />
        </View>
      </ScrollView>
    </Screen>
  );
}
