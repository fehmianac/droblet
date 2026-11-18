import { Star } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { formatNumber } from '@/lib/format';

import { Icon } from './Icon';
import { ImageSlot, type Piece } from './ImageSlot';
import { Text } from './Text';

type Props = {
  name: string;
  /** Occasion / day label shown above the name. */
  tag: string;
  imageUri?: string | null;
  /** The look's pieces: drawn as a collage while there is no rendered image. */
  pieces?: Piece[];
  /** Stable id of the look: picks the ground of the figure placeholder when there are no pieces either. */
  seed?: string;
  /** Friends' average rating, when present. */
  rating?: number | null;
  onPress: () => void;
  className?: string;
};

/** Image + occasion tag + name + optional friends' rating. */
export function LookCard({ name, tag, imageUri, pieces, seed, rating, onPress, className }: Props) {
  const { t } = useTranslation();
  const ratingText =
    rating != null ? formatNumber(rating, { maximumFractionDigits: 1 }) : null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[tag, name, ratingText ? t('a11y.rating', { rating: ratingText }) : null].filter(Boolean).join(', ')}
      className={`gap-2 ${className ?? ''}`}
    >
      <ImageSlot uri={imageUri} className="aspect-[4/5] w-full rounded-image-lg" placeholder={{ kind: 'look', pieces: pieces ?? [], seed: seed ?? name }} />
      <View className="gap-0.5">
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {tag}
        </Text>
        <View className="flex-row items-center justify-between gap-2">
          <Text variant="bodyMedium" numberOfLines={1} className="flex-1">
            {name}
          </Text>
          {ratingText ? (
            <View className="flex-row items-center gap-1">
              <Icon icon={Star} size={14} tone="accent" filled />
              <Text variant="caption">{ratingText}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
