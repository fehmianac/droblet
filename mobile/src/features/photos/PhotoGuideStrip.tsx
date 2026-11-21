import { Image } from 'expo-image';
import { Check, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { AppSegment } from '@/api/contracts';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useSegment } from '@/features/segment/store';
import { placeholderTones, visualTones } from '@/theme/tokens';

/** The one bundled guide photo per segment (canvas 22c); the two wrong examples are derived from it on the phone. */
const GUIDE_PHOTOS: Record<AppSegment, number> = {
  women: require('../../../assets/visuals/photo-guide-woman.webp'),
  men: require('../../../assets/visuals/photo-guide-man.webp'),
};

type Example = 'good' | 'dark' | 'half';
const EXAMPLES: Example[] = ['good', 'dark', 'half'];

/** Full frame at 50% 40%; the half-body crop is the same photo at 2.1x from the top (canvas `scale(2.1)`, origin 50% 8%). */
const FULL_POSITION = { left: '50%', top: '40%' } as const;
const HALF_POSITION = { left: '50%', top: '0%' } as const;
const HALF_ZOOM = 2.1;

function ExampleTile({ example, segment }: { example: Example; segment: AppSegment }) {
  const { t } = useTranslation();
  const ok = example === 'good';
  return (
    <View
      className="flex-1 gap-1.5"
      accessible
      accessibilityRole="image"
      accessibilityLabel={t(`photoGuide.${example}A11y`)}
      testID={`photoGuide.example.${example}`}
    >
      <View
        className={`h-[132px] overflow-hidden rounded-image ${ok ? 'border-[1.5px] border-ink bg-sand' : 'bg-sand'}`}
        style={example === 'dark' ? { backgroundColor: placeholderTones.dark } : undefined}
      >
        <Image
          source={GUIDE_PHOTOS[segment]}
          contentFit="cover"
          contentPosition={example === 'half' ? HALF_POSITION : FULL_POSITION}
          // "Karanlık": slightly blurred and dimmed to ~38% brightness (overlay below). "Yarım beden": zoomed to the upper body.
          blurRadius={example === 'dark' ? 2 : undefined}
          style={[StyleSheet.absoluteFill, example === 'half' ? styles.half : null]}
          accessible={false}
          testID={`photoGuide.photo.${segment}`}
        />
        {example === 'dark' ? <View style={[StyleSheet.absoluteFill, { backgroundColor: visualTones.dim }]} pointerEvents="none" /> : null}
        <View className={`absolute right-1.5 top-1.5 h-5 w-5 items-center justify-center rounded-pill ${ok ? 'bg-ink' : 'bg-danger'}`}>
          <Icon icon={ok ? Check : X} size={11} tone={ok ? 'cream' : 'paper'} />
        </View>
      </View>
      <Text variant="caption" tone={ok ? 'ink' : 'muted'} className="text-[11.5px] leading-[15px]">
        {t(`photoGuide.${example}`)}
      </Text>
    </View>
  );
}

/**
 * "İyi bir boy fotoğrafı" (canvas 22c): one right and two wrong full-length photo examples, the same strip on 04 Beden
 * and the 11d full-length photo step. One AI image per segment; "Karanlık" and "Yarım beden" are derived from it here.
 */
export function PhotoGuideStrip() {
  const { t } = useTranslation();
  const segment = useSegment();
  return (
    <View className="gap-2" testID="photoGuide.strip">
      <Text variant="bodyMedium">{t('photoGuide.title')}</Text>
      <View className="flex-row gap-2" accessibilityRole="list" accessibilityLabel={t('photoGuide.listLabel')}>
        {EXAMPLES.map((example) => (
          <ExampleTile key={example} example={example} segment={segment} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  half: { transform: [{ scale: HALF_ZOOM }], transformOrigin: '50% 8%' },
});
