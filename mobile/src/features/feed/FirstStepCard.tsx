import { useFocusEffect } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { Piece } from '@/components/ui/ImageSlot';
import { Icon } from '@/components/ui/Icon';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Text } from '@/components/ui/Text';
import { hasTriedOn } from '@/features/credits/spendConfirm';
import { feedTones } from '@/theme/tokens';

/**
 * Whether this user ever started a try-on on this phone (the same "tried" flag as the credit confirmation, kept on the
 * device). `null` while unknown — nothing is drawn until it is known. Re-read whenever the screen gets focus, so the
 * card leaves after the first try-on.
 */
export function useHasTriedOn(): boolean | null {
  const [tried, setTried] = useState<boolean | null>(null);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void hasTriedOn().then((value) => alive && setTried(value));
      return () => {
        alive = false;
      };
    }, []),
  );
  return tried;
}

type Props = {
  /** Photo of the first post (the polaroid), null for the look placeholder. */
  imageUrl: string | null;
  pieces: Piece[];
  onPress: () => void;
};

/**
 * "İlk look'unu dene" (canvas 06″ · İLK ADIM): only for users who never tried anything on. A tilted paper card with
 * a polaroid of a look, the eyebrow, the serif title and one sentence; tapping it brings the first post into view.
 */
export function FirstStepCard({ imageUrl, pieces, onPress }: Props) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('homeFeed.firstStepA11y')}
      testID="feed.firstStep"
      className="flex-row items-center gap-3.5 overflow-hidden rounded-[18px] bg-sand py-3 pl-3 pr-3.5 active:opacity-85"
    >
      <View className="h-[74px] w-[74px]" accessible={false}>
        <View className="absolute left-0 top-1.5 h-[66px] w-[58px] rounded-[6px] bg-paper shadow-sm" style={{ transform: [{ rotate: '-9deg' }] }} />
        <View
          className="absolute left-3 top-0 h-[70px] w-[60px] overflow-hidden rounded-[6px] border-[3px] border-paper shadow-md"
          style={{ transform: [{ rotate: '3deg' }] }}
        >
          <ImageSlot uri={imageUrl} className="h-full w-full" placeholder={{ kind: 'look', pieces, seed: 'first-step', figureHeight: 52 }} />
        </View>
      </View>
      <View className="flex-1 gap-[3px]">
        <Text variant="eyebrow" tone="accent">
          {t('homeFeed.firstStepEyebrow')}
        </Text>
        <Text variant="h3" className="text-[22px] leading-[23px]">
          {t('homeFeed.firstStepTitle')}
        </Text>
        <Text variant="caption" style={{ color: feedTones.body }}>
          {t('homeFeed.firstStepBody')}
        </Text>
      </View>
      <Icon icon={ChevronRight} size={20} />
    </Pressable>
  );
}
