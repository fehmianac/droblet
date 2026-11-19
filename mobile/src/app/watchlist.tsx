import { router } from 'expo-router';
import { Bell, BellOff, Bookmark } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import type { ProductSummary, WatchlistEntry } from '@/api/contracts/store';
import { useBodyProfile } from '@/api/profile';
import { Card } from '@/components/blocks/basics';
import { BrandMark } from '@/components/blocks/BrandMark';
import { CartButton } from '@/components/blocks/SectionState';
import { Badge } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { ListTabBar } from '@/components/navigation/TabBar';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { preferredSize, priceDropPercent } from '@/features/store/cartMath';
import { useAddToCart, useSetWatch } from '@/features/store/mutations';
import { useWatchlist } from '@/features/store/queries';
import { formatMoney, formatPercent } from '@/lib/format';
import { useThemeColors } from '@/theme/useThemeColors';

function toProduct(entry: WatchlistEntry): ProductSummary {
  return {
    id: entry.productId,
    brandId: entry.brandId,
    brandName: entry.brandName,
    brandLogoUrl: entry.brandLogoUrl ?? null,
    name: entry.name,
    price: entry.price,
    imageUrl: entry.imageUrl,
    category: entry.category,
    colors: entry.colors,
    sizes: entry.sizes,
  };
}

function WatchCard({ entry, profileSize }: { entry: WatchlistEntry; profileSize: string | null }) {
  const { t } = useTranslation();
  const setWatch = useSetWatch();
  const addToCart = useAddToCart();
  const drop = priceDropPercent(entry.price, entry.previousPrice);
  const openProduct = () => router.push({ pathname: '/shop/product/[id]', params: { id: entry.productId } });
  const sourceText =
    entry.source.kind === 'look'
      ? t('watchlist.fromLook', { name: entry.source.lookName })
      : entry.source.kind === 'edit'
        ? t('watchlist.fromEdit')
        : entry.source.kind === 'auto'
          ? t('watchlist.fromBrandVisit')
          : null;

  const add = () => {
    const size = preferredSize(entry.sizes, profileSize);
    // Without a clear size the user picks it on the product page.
    if (!size) {
      openProduct();
      return;
    }
    addToCart([{ product: toProduct(entry), size }], 'watchlist');
    router.push('/cart');
  };

  const price = entry.price !== null ? formatMoney(entry.price) : null;
  const alertLabel = t(entry.alertEnabled ? 'watchlist.alertOn' : 'watchlist.alertOff');

  return (
    <Card className="gap-2.5 p-3">
      <View className="flex-row items-center gap-3">
        <Pressable
          onPress={openProduct}
          accessibilityRole="button"
          accessibilityLabel={[entry.brandName, entry.name, price, drop !== null ? t('watchlist.priceDropped', { percent: formatPercent(drop) }) : null]
            .filter(Boolean)
            .join(', ')}
          className="flex-1 flex-row items-center gap-3 active:opacity-80"
        >
          <ImageSlot
            uri={entry.imageUrl}
            className="h-[78px] w-16 rounded-thumb"
            placeholder={{ kind: 'garment', category: entry.category, color: entry.colors[0], glyphSize: 26 }}
          />
          <View className="flex-1">
            <BrandMark name={entry.brandName} logoUrl={entry.brandLogoUrl} />
            <Text variant="body" numberOfLines={2} className="mt-0.5">
              {entry.name}
            </Text>
            {price !== null ? (
              <View className="mt-1 flex-row flex-wrap items-baseline gap-1">
                {drop !== null && entry.previousPrice !== null ? (
                  <Text
                    variant="chip"
                    tone="muted"
                    className="line-through"
                    accessibilityLabel={t('watchlist.oldPrice', { price: formatMoney(entry.previousPrice) })}
                  >
                    {formatMoney(entry.previousPrice)}
                  </Text>
                ) : null}
                <Text variant="price">{price}</Text>
              </View>
            ) : null}
            {drop !== null ? (
              <View className="mt-1">
                <Badge tone="accent" label={t('watchlist.priceDropped', { percent: formatPercent(drop) })} />
              </View>
            ) : null}
          </View>
        </Pressable>
        {/* The bell is the price alert of this one product: ink when on, muted and struck through when off. */}
        <Pressable
          onPress={() => setWatch({ productId: entry.productId, watching: true, alertEnabled: !entry.alertEnabled })}
          accessibilityRole="switch"
          accessibilityLabel={alertLabel}
          accessibilityState={{ checked: entry.alertEnabled }}
          testID={`watch-bell-${entry.productId}`}
          className="h-icon-btn w-icon-btn items-center justify-center rounded-pill active:opacity-70"
        >
          <Icon icon={entry.alertEnabled ? Bell : BellOff} size={20} tone={entry.alertEnabled ? 'ink' : 'muted'} />
        </Pressable>
      </View>
      {sourceText !== null || drop !== null ? (
        <View className="flex-row items-center gap-2">
          <Text variant="caption" tone="muted" className="flex-1" numberOfLines={2}>
            {sourceText ?? ''}
          </Text>
          {drop !== null ? (
            <Button size="md" label={t('watchlist.addToCart')} onPress={add} className="px-4" />
          ) : (
            <Button variant="secondary" size="md" label={t('watchlist.viewProduct')} onPress={openProduct} className="px-4" />
          )}
        </View>
      ) : null}
    </Card>
  );
}

/**
 * 24b İzleme listem — missing pieces of looks and products the user watches (separate from the
 * heart / favourites). A price drop shows the old and new price with the "Fiyat %20 düştü" badge and
 * "Sepete ekle"; other entries that came from a look or the edit show "Ürünü gör". The bell turns the
 * price alert for one product on or off. Tapping the product opens it (22).
 */
export default function WatchlistScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const watchlist = useWatchlist();
  const profileSize = useBodyProfile().data?.size ?? null;

  return (
    <Screen>
      <ScreenHeader leading="back" right={<CartButton />} />
      <ScreenState
        query={watchlist}
        isEmpty={(data) => data.items.length === 0}
        empty={{ icon: Bookmark, title: t('watchlist.title'), message: t('watchlist.empty'), actionLabel: t('watchlist.emptyAction'), onAction: () => router.push('/shop') }}
      >
        {(data) => (
          <FlatList
            data={data.items}
            keyExtractor={(item) => item.productId}
            contentContainerClassName="gap-2.5 px-gutter pb-8 pt-1"
            refreshControl={
              <RefreshControl refreshing={watchlist.isRefetching} onRefresh={() => void watchlist.refetch()} tintColor={colors.muted} />
            }
            ListHeaderComponent={
              <View className="gap-3.5 pb-1">
                <View className="gap-1.5">
                  <Text variant="eyebrow">{t('watchlist.eyebrow')}</Text>
                  <Text variant="display">{t('watchlist.title')}</Text>
                </View>
                <Text variant="body" tone="muted">
                  {t('watchlist.body')}
                </Text>
              </View>
            }
            renderItem={({ item }) => <WatchCard entry={item} profileSize={profileSize} />}
          />
        )}
      </ScreenState>
      <ListTabBar owner="profile" />
    </Screen>
  );
}
