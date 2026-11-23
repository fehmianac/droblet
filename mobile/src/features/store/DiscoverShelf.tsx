import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import type { AppSegment } from '@/api/contracts';
import type { ProductCategory } from '@/api/contracts/store';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';


import { useSetFavorite } from './mutations';
import { EMPTY_PRODUCT_QUERY, useFavoriteProducts, useProducts } from './queries';
import { ShopProductCard } from './ShopProductCard';

/** Products on one shelf: enough to scroll sideways; the rest is one tap away in the store. */
export const SHELF_PRODUCT_COUNT = 10;
/** Width of a shelf card: two and a bit fit a phone, so the row reads as "there is more". */
const CARD_WIDTH = 148;

/**
 * Keşfet › "Tümü" shelves, in order (canvas 20 · Tümü): the kinds a catalogue is browsed by. The women's row has
 * dresses where the men's has shirts. A shelf without products is not drawn.
 */
export function discoverShelfCategories(segment: AppSegment): ProductCategory[] {
  return segment === 'men' ? ['coat', 'jacket', 'shirt', 'shoes', 'bag'] : ['coat', 'jacket', 'dress', 'shoes', 'bag'];
}

type Props = { category: ProductCategory; brandId: string | null; enabled: boolean };

/**
 * One shelf of Keşfet › "Tümü": the category's name, "Tümü" (opens the store on that category, and on the chosen
 * brand) and its newest products in a row that scrolls sideways. Narrowed by the brand chip like the grid above it.
 * Nothing is drawn when the category has no product (for that brand).
 */
export function DiscoverShelf({ category, brandId, enabled }: Props) {
  const { t } = useTranslation();
  const query = useMemo(() => ({ ...EMPTY_PRODUCT_QUERY, categories: [category], brandIds: brandId ? [brandId] : [] }), [category, brandId]);
  const products = useProducts(query, enabled);
  const favorites = useFavoriteProducts();
  const setFavorite = useSetFavorite();
  const favoriteIds = favorites.data?.productIds ?? [];
  const items = (products.data?.pages[0]?.items ?? []).slice(0, SHELF_PRODUCT_COUNT);
  const title = t(`shop.category.${category}`);

  if (!enabled || products.isError) return null;
  if (products.isPending) {
    return (
      <View className="gap-3.5" testID={`discover.shelf.${category}.loading`}>
        <Skeleton className="ml-gutter h-5 w-28 rounded-pill" />
        <View className="flex-row gap-3 px-gutter">
          <Skeleton className="h-[230px] w-[148px] rounded-image-lg" />
          <Skeleton className="h-[230px] w-[148px] rounded-image-lg" />
          <Skeleton className="h-[230px] flex-1 rounded-image-lg" />
        </View>
      </View>
    );
  }
  if (items.length === 0) return null;

  return (
    <View className="gap-3.5" testID={`discover.shelf.${category}`}>
      <View className="flex-row items-center justify-between px-gutter">
        <Text variant="h3">{title}</Text>
        <Pressable
          onPress={() => router.push({ pathname: '/shop', params: { category, ...(brandId ? { brand: brandId } : {}) } })}
          accessibilityRole="link"
          accessibilityLabel={t('discover.shelfAllA11y', { category: title })}
          hitSlop={8}
          className="min-h-icon-btn flex-row items-center gap-0.5 active:opacity-70"
          testID={`discover.shelf.${category}.all`}
        >
          <Text variant="label">{t('common.seeAll')}</Text>
          <Icon icon={ChevronRight} size={14} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 px-gutter">
        {items.map((item, index) => (
          <View key={item.id} style={{ width: CARD_WIDTH }}>
            <ShopProductCard
              testID={`discover.shelf.${category}.product.${index}`}
              product={item}
              favorite={favoriteIds.includes(item.id)}
              onToggleFavorite={() => setFavorite(item.id, !favoriteIds.includes(item.id))}
              onPress={() => router.push({ pathname: '/shop/product/[id]', params: { id: item.id } })}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
