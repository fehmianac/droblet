import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { CreatorCard } from '@/api/contracts/store';
import { ImageTag } from '@/components/ui/Bits';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Text } from '@/components/ui/Text';

/**
 * A creator's featured look (20 strip, Influencer chip) as drawn: 170-high image (radius 14) with the
 * standing figure while there is no photo, a 20 avatar dot + name (12 medium) and the look title.
 * `sponsored` puts the "SPONSORLU" image tag on the top-left corner and opens the store; a creator
 * opens their profile (26). Sponsorship starts later — the flag comes from the content API.
 */
export function CreatorCardView({ creator, className }: { creator: CreatorCard; className?: string }) {
  const { t } = useTranslation();
  const open = () => {
    if (creator.handle) router.push({ pathname: '/u/[handle]', params: { handle: creator.handle } });
    else router.push('/shop');
  };
  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={[creator.sponsored ? t('explore.sponsoredA11y') : null, creator.displayName, creator.lookTitle]
        .filter(Boolean)
        .join(', ')}
      className={`gap-1.5 active:opacity-80 ${className ?? 'w-[132px]'}`}
    >
      <ImageSlot
        uri={creator.imageUrl}
        className="h-[170px] w-full rounded-image-lg"
        placeholder={{ kind: 'look', pieces: [], seed: creator.id, figureHeight: 105 }}
      >
        {creator.sponsored ? <ImageTag label={t('explore.sponsored')} className="absolute left-2 top-2" /> : null}
      </ImageSlot>
      <View className="flex-row items-center gap-1.5">
        <ImageSlot className="h-5 w-5 rounded-pill" placeholder={{ kind: 'avatar', name: creator.handle ?? creator.displayName }} />
        <Text variant="label" numberOfLines={1} className="flex-1">
          {creator.displayName}
        </Text>
      </View>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {creator.lookTitle}
      </Text>
    </Pressable>
  );
}
