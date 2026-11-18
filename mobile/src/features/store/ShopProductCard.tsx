import { Heart } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { ProductSummary } from '@/api/contracts/store';
import { BrandMark } from '@/components/blocks/BrandMark';
import { Icon } from '@/components/ui/Icon';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { Text } from '@/components/ui/Text';
import { formatMoney } from '@/lib/format';

type Props = { product: ProductSummary; favorite: boolean; onToggleFavorite: () => void; onPress: () => void };

/**
 * Catalogue grid card (21) as drawn: 180-high image (radius 12), a 32 paper heart 8 in from the top-right
 * corner, BRAND, the name (13) and the price (13 medium). Priced with `Money` through the locale-aware
 * formatter; a product without a published price shows no price line. The heart is the favourite —
 * separate from the watchlist.
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
        className="gap-[5px] active:opacity-80"
      >
        <PlaceholderImage uri={product.imageUrl} className="h-[180px] w-full rounded-image" />
        <BrandMark name={product.brandName} logoUrl={product.brandLogoUrl} />
        <Text variant="chip" numberOfLines={1} className="-mt-0.5">
          {product.name}
        </Text>
        {price ? <Text variant="price">{price}</Text> : null}
      </Pressable>
      {/* 32 drawn, 44 touchable. */}
      <Pressable
        onPress={onToggleFavorite}
        accessibilityRole="button"
        accessibilityState={{ selected: favorite }}
        accessibilityLabel={t(favorite ? 'shop.favoriteRemove' : 'shop.favoriteAdd')}
        hitSlop={6}
        className="absolute right-2 top-2 h-8 w-8 items-center justify-center rounded-pill bg-paper/90 active:opacity-70"
      >
        <Icon icon={Heart} size={16} filled={favorite} />
      </Pressable>
    </View>
  );
}
