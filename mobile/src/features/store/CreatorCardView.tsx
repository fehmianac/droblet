import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { CreatorCard } from '@/api/contracts/store';
import { Avatar, SponsoredTag } from '@/components/blocks/basics';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { Text } from '@/components/ui/Text';

/**
 * A creator's featured look (20 strip, Influencer chip). A sponsored showcase carries the
 * "SPONSORLU" label and opens the store; a creator opens their profile (26).
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
      className={`gap-2 active:opacity-80 ${className ?? ''}`}
    >
      <View>
        <PlaceholderImage uri={creator.imageUrl} className="aspect-[3/4] w-full rounded-image-lg" />
        {creator.sponsored ? (
          <View className="absolute left-2 top-2" pointerEvents="none">
            <SponsoredTag />
          </View>
        ) : null}
      </View>
      <View className="flex-row items-center gap-2">
        <Avatar name={creator.displayName} size={22} />
        <Text variant="bodyMedium" numberOfLines={1} className="flex-1">
          {creator.displayName}
        </Text>
      </View>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {creator.lookTitle}
      </Text>
    </Pressable>
  );
}
