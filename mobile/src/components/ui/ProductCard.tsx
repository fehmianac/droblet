import { Heart } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { formatMoney, type Money } from '@/lib/format';
import { toBrandUpper } from '@/lib/upper';

import { IconButton } from './IconButton';
import { PlaceholderImage } from './PlaceholderImage';
import { Text } from './Text';

type Props = {
  brand: string;
  name: string;
  price: Money | null;
  imageUri?: string | null;
  favorite: boolean;
  onToggleFavorite: () => void;
  onPress: () => void;
};

/** Grid card for 2-column product lists: 4:5 image, heart top-right. */
export function ProductCard({ brand, name, price, imageUri, favorite, onToggleFavorite, onPress }: Props) {
  const { t } = useTranslation();
  return (
    <View className="flex-1">
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={[brand, name, price !== null ? formatMoney(price) : null].filter(Boolean).join(', ')}
        className="gap-2"
      >
        <PlaceholderImage uri={imageUri} className="aspect-[4/5] w-full rounded-image-lg" />
        <View className="gap-0.5">
          <Text variant="brand" tone="muted" numberOfLines={1}>
            {toBrandUpper(brand)}
          </Text>
          <Text variant="body" numberOfLines={1}>
            {name}
          </Text>
          {price !== null ? <Text variant="bodyMedium">{formatMoney(price)}</Text> : null}
        </View>
      </Pressable>
      <View className="absolute right-2 top-2">
        <IconButton
          icon={Heart}
          variant="inverse"
          active={favorite}
          onPress={onToggleFavorite}
          accessibilityLabel={t(favorite ? 'a11y.unfavorite' : 'a11y.favorite')}
        />
      </View>
    </View>
  );
}
