import { router } from 'expo-router';
import { Bell, BellOff } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, View } from 'react-native';

import type { ProductSummary, WatchlistEntry } from '@/api/contracts/store';
import { useBodyProfile } from '@/api/profile';
import { Badge, Card } from '@/components/blocks/basics';
import { CartButton } from '@/components/blocks/SectionState';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { preferredSize, priceDropPercent } from '@/features/store/cartMath';
import { useAddToCart, useSetWatch } from '@/features/store/mutations';
import { useWatchlist } from '@/features/store/queries';
import { currentLanguage } from '@/i18n';
import { formatMoney, formatPercent } from '@/lib/intl';
import { toDisplayUpper } from '@/lib/upper';
import { useThemeColors } from '@/theme/useThemeColors';

function toProduct(entry: WatchlistEntry): ProductSummary {
  return {
    id: entry.productId,
    brandId: entry.brandId,
    brandName: entry.brandName,
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

  return (
    <Card className="gap-3 p-3.5">
      <View className="flex-row gap-3">
        <PlaceholderImage uri={entry.imageUrl} className="h-[84px] w-[68px] rounded-image" />
        <View className="flex-1 gap-0.5">
          <Text variant="brand" tone="muted" numberOfLines={1}>
            {toDisplayUpper(entry.brandName, currentLanguage())}
          </Text>
          <Text variant="body" numberOfLines={2}>
            {entry.name}
          </Text>
          {entry.price !== null ? (
            <View className="flex-row flex-wrap items-baseline gap-2">
              {drop !== null && entry.previousPrice !== null ? (
                <Text
                  variant="caption"
                  tone="muted"
                  className="line-through"
                  accessibilityLabel={t('watchlist.oldPrice', { price: formatMoney(entry.previousPrice) })}
                >
                  {formatMoney(entry.previousPrice)}
                </Text>
              ) : null}
              <Text variant="bodyMedium">{formatMoney(entry.price)}</Text>
            </View>
          ) : null}
          {drop !== null ? (
            <View className="mt-1">
              <Badge tone="accent" label={t('watchlist.priceDropped', { percent: formatPercent(drop) })} />
            </View>
          ) : null}
        </View>
        <IconButton
          icon={entry.alertEnabled ? Bell : BellOff}
          active={entry.alertEnabled}
          onPress={() => setWatch({ productId: entry.productId, watching: true, alertEnabled: !entry.alertEnabled })}
          accessibilityLabel={t(entry.alertEnabled ? 'watchlist.alertOn' : 'watchlist.alertOff')}
        />
      </View>
      <View className="flex-row items-center justify-between gap-3">
        <Text variant="caption" tone="muted" className="flex-1" numberOfLines={2}>
          {sourceText ?? ''}
        </Text>
        {drop !== null ? (
          <Button label={t('watchlist.addToCart')} onPress={add} className="h-btn-secondary px-5" />
        ) : (
          <Button variant="secondary" label={t('watchlist.viewProduct')} onPress={openProduct} />
        )}
      </View>
    </Card>
  );
}

function WatchlistSkeleton() {
  return (
    <View className="gap-3 px-gutter pt-2">
      <Skeleton className="h-8 w-48 rounded-field" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-36 w-full rounded-card" />
      ))}
    </View>
  );
}

/**
 * 24b İzleme listem — missing pieces of looks and products the user watches (separate from the
 * heart / favourites). A price drop shows the old and new price with a badge; the bell turns the
 * price alert for one product on or off.
 */
export default function WatchlistScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const watchlist = useWatchlist();
  const profileSize = useBodyProfile().data?.size ?? null;

  return (
    <Screen bottom>
      <ScreenHeader leading="back" right={<CartButton />} />
      <ScreenState
        query={watchlist}
        skeleton={<WatchlistSkeleton />}
        isEmpty={(data) => data.items.length === 0}
        empty={{ message: t('watchlist.empty'), actionLabel: t('watchlist.emptyAction'), onAction: () => router.push('/shop') }}
      >
        {(data) => (
          <FlatList
            data={data.items}
            keyExtractor={(item) => item.productId}
            contentContainerClassName="gap-3 px-gutter pb-8"
            refreshControl={
              <RefreshControl refreshing={watchlist.isRefetching} onRefresh={() => void watchlist.refetch()} tintColor={colors.muted} />
            }
            ListHeaderComponent={
              <View className="gap-2 pb-2">
                <Text variant="eyebrow">{t('watchlist.eyebrow')}</Text>
                <Text variant="display">{t('watchlist.title')}</Text>
                <Text variant="body" tone="muted">
                  {t('watchlist.body')}
                </Text>
              </View>
            }
            renderItem={({ item }) => <WatchCard entry={item} profileSize={profileSize} />}
          />
        )}
      </ScreenState>
    </Screen>
  );
}
