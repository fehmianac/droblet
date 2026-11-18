import { Heart } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { ProductSummary } from '@/api/contracts/store';
import { BrandMark } from '@/components/blocks/BrandMark';
import { IconButton } from '@/components/ui/IconButton';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { Text } from '@/components/ui/Text';
import { formatMoney } from '@/lib/intl';

type Props = { product: ProductSummary; favorite: boolean; onToggleFavorite: () => void; onPress: () => void };

/**
 * Catalogue grid card (21): 4:5 image, favourite heart, BRAND, one-line name, price.
 * Same look as the design-system `ProductCard`, but priced with `Money` (minor units + ISO currency)
 * through the locale-aware formatter, and with the favourites wording for the heart.
 */
export function ShopProductCard({ product, favorite, onToggleFavorite, onPress }: Props) {
  const { t } = useTranslation();
  const price = product.price ? formatMoney(product.price) : null;
  return (
    <View>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={[product.brandName, product.name, price].filter(Boolean).join(', ')}
        className="gap-2 active:opacity-80"
      >
        <PlaceholderImage uri={product.imageUrl} className="aspect-[4/5] w-full rounded-image-lg" />
        <View className="gap-0.5">
          <BrandMark name={product.brandName} logoUrl={product.brandLogoUrl} />
          <Text variant="body" numberOfLines={1}>
            {product.name}
          </Text>
          {price ? <Text variant="bodyMedium">{price}</Text> : null}
        </View>
      </Pressable>
      <View className="absolute right-2 top-2">
        <IconButton
          icon={Heart}
          variant="inverse"
          active={favorite}
          onPress={onToggleFavorite}
          accessibilityLabel={t(favorite ? 'shop.favoriteRemove' : 'shop.favoriteAdd')}
        />
      </View>
    </View>
  );
}
