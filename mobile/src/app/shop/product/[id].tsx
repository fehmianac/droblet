import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Bookmark, Check, ChevronLeft, CircleAlert, Heart } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { ONE_SIZE, type ProductDetail, type ProductSize } from '@/api/contracts/store';
import { useBodyProfile } from '@/api/profile';
import { Card } from '@/components/blocks/basics';
import { CartButton } from '@/components/blocks/SectionState';
import { AiImage } from '@/components/ui/AiBadge';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Button } from '@/components/ui/Button';
import { Chip, ChipWrap } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useMyPhotos } from '@/features/account/queries';
import { useAiGate } from '@/features/credits/useAiGate';
import { preferredSize } from '@/features/store/cartMath';
import {
  useAddItemFromProduct,
  useAddToCart,
  useRequestTryOn,
  useSetFavorite,
  useSetWatch,
} from '@/features/store/mutations';
import {
  productTryOnOptions,
  useFavoriteProducts,
  useProduct,
  useProductMatch,
  useProductTryOn,
  useWatchlist,
} from '@/features/store/queries';
import { currentLanguage } from '@/i18n';
import { formatMoney } from '@/lib/intl';
import { suffixed } from '@/lib/trSuffix';
import { toDisplayUpper } from '@/lib/upper';

type ProductView = 'product' | 'onMe';

function DetailSkeleton() {
  return (
    <View className="gap-5">
      <Skeleton className="aspect-[4/5] w-full" />
      <View className="gap-3 px-gutter">
        <Skeleton className="h-3 w-24 rounded-field" />
        <Skeleton className="h-7 w-56 rounded-field" />
        <Skeleton className="h-chip w-full rounded-pill" />
        <Skeleton className="h-16 w-full rounded-card" />
      </View>
    </View>
  );
}

function ProductBody({ product }: { product: ProductDetail }) {
  const { t } = useTranslation();
  const language = currentLanguage();
  const client = useQueryClient();
  const gate = useAiGate();

  const bodyProfile = useBodyProfile();
  const photos = useMyPhotos();
  const match = useProductMatch(product.id);
  const favorites = useFavoriteProducts();
  const watchlist = useWatchlist();
  const setFavorite = useSetFavorite();
  const setWatch = useSetWatch();
  const addToCart = useAddToCart();
  const addToWardrobe = useAddItemFromProduct();
  const requestTryOn = useRequestTryOn();

  const [view, setView] = useState<ProductView>('product');
  /** True once a try-on was asked for in this visit; a `none` answer after that means it was declined. */
  const [requested, setRequested] = useState(false);
  const [pickedSize, setPickedSize] = useState<ProductSize | null>(null);
  const [sizeError, setSizeError] = useState(false);
  const [addedToWardrobe, setAddedToWardrobe] = useState(false);

  const tryOn = useProductTryOn(product.id, view === 'onMe');

  const profileSize = bodyProfile.data?.size ?? null;
  const defaultSize = preferredSize(product.sizes, profileSize);
  const size = pickedSize ?? defaultSize;
  const sizeIsFromProfile = pickedSize === null && defaultSize !== null && defaultSize === profileSize;

  const favorite = favorites.data?.productIds.includes(product.id) ?? false;
  const watching = watchlist.data?.items.some((i) => i.productId === product.id) ?? false;
  const needsPhoto = photos.data !== undefined && photos.data.body.length === 0;
  const shownView: ProductView = view === 'onMe' && requested && tryOn.data?.status === 'none' ? 'product' : view;

  const showOnMe = async () => {
    // Not a member → paywall. Viewing an image that already exists costs nothing.
    if (!gate('product_try_on', () => undefined, { costsCredit: false })) return;
    setRequested(false);
    setView('onMe');
    if (needsPhoto) return;
    const state = await client.fetchQuery(productTryOnOptions(product.id)).catch(() => null);
    if (state?.status !== 'none') return;
    // A new image costs one credit; with none left the 05b sheet opens instead.
    const started = gate('product_try_on', () => requestTryOn(product.id));
    setRequested(true);
    if (!started) setView('product');
  };

  const requireSize = (action: (chosen: ProductSize) => void) => {
    if (!size) {
      setSizeError(true);
      return;
    }
    action(size);
  };

  let image;
  if (shownView === 'product') {
    image = <PlaceholderImage uri={product.imageUrl} className="aspect-[4/5] w-full" accessibilityLabel={product.name} />;
  } else if (needsPhoto) {
    image = (
      <View className="aspect-[4/5] w-full items-center justify-center gap-4 bg-sand px-8">
        <Text variant="body" className="text-center">
          {t('productDetail.tryOnNeedsPhoto')}
        </Text>
        <Button variant="secondary" label={t('productDetail.tryOnAddPhoto')} onPress={() => router.push('/settings')} />
      </View>
    );
  } else if (tryOn.data?.status === 'done') {
    image = <AiImage kind="onYou" uri={tryOn.data.imageUrl} className="aspect-[4/5] w-full" accessibilityLabel={product.name} />;
  } else if (tryOn.data?.status === 'failed' || tryOn.status === 'error') {
    image = (
      <View className="aspect-[4/5] w-full items-center justify-center gap-4 bg-sand px-8" accessibilityLiveRegion="polite">
        <Text variant="body" className="text-center">
          {t('productDetail.tryOnFailed')}
        </Text>
        <Button variant="secondary" label={t('common.retry')} onPress={() => void showOnMe()} />
      </View>
    );
  } else {
    // AI loading component — replace this skeleton with the shared "AiYukleniyor" wait when it lands.
    image = (
      <View accessible accessibilityLabel={t('productDetail.tryOnPreparing')} accessibilityLiveRegion="polite">
        <Skeleton className="aspect-[4/5] w-full" />
        <View className="absolute bottom-16 left-0 right-0 items-center">
          <Text variant="caption" tone="muted">
            {t('productDetail.tryOnPreparing')}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <>
      <ScrollView contentContainerClassName="gap-5 pb-8">
        <View>
          {image}
          <View className="absolute left-gutter right-gutter top-3 flex-row justify-between">
            <IconButton icon={ChevronLeft} variant="inverse" onPress={() => router.back()} accessibilityLabel={t('a11y.back')} />
            <View className="flex-row gap-2">
              <CartButton variant="inverse" />
              <IconButton
                icon={Heart}
                variant="inverse"
                active={favorite}
                onPress={() => setFavorite(product.id, !favorite)}
                accessibilityLabel={t(favorite ? 'shop.favoriteRemove' : 'shop.favoriteAdd')}
              />
            </View>
          </View>
          <View
            className="absolute bottom-3 left-0 right-0 flex-row justify-center gap-2"
            accessibilityRole="tablist"
            accessibilityLabel={t('productDetail.viewToggle')}
          >
            <Chip label={t('productDetail.viewProduct')} selected={shownView === 'product'} onPress={() => setView('product')} />
            <Chip label={t('productDetail.viewOnMe')} selected={shownView === 'onMe'} onPress={() => void showOnMe()} />
          </View>
        </View>

        <View className="gap-5 px-gutter">
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1 gap-1">
              <Text variant="brand" tone="muted">
                {toDisplayUpper(product.brandName, language)}
              </Text>
              <Text variant="h2">{product.name}</Text>
            </View>
            {product.price !== null ? <Text variant="h3">{formatMoney(product.price)}</Text> : null}
          </View>

          <View className="gap-2">
            <View className="flex-row flex-wrap items-baseline gap-1">
              <Text variant="bodyMedium">{t('productDetail.sizeLabel')}</Text>
              {sizeIsFromProfile ? (
                <Text variant="caption" tone="muted">
                  {t('productDetail.sizeFromProfile')}
                </Text>
              ) : null}
            </View>
            <ChipWrap>
              {product.sizes.map((s) => (
                <Chip
                  key={s}
                  label={s === ONE_SIZE ? t('shop.oneSize') : s}
                  selected={size === s}
                  onPress={() => {
                    setPickedSize(s);
                    setSizeError(false);
                  }}
                />
              ))}
            </ChipWrap>
            {sizeError ? (
              <View className="flex-row items-center gap-1.5" accessibilityLiveRegion="polite">
                <Icon icon={CircleAlert} size={14} tone="danger" />
                <Text variant="caption" tone="danger">
                  {t('productDetail.sizeRequired')}
                </Text>
              </View>
            ) : null}
          </View>

          {match.data ? (
            <Card className="flex-row items-center justify-between gap-3 px-4 py-2">
              <Text variant="body" className="flex-1">
                {match.data.count > 0 ? t('productDetail.matchCount', { count: match.data.count }) : t('productDetail.matchNone')}
              </Text>
              {match.data.count > 0 ? (
                <Button
                  variant="text"
                  label={t('productDetail.matchShow')}
                  onPress={() => router.push({ pathname: '/shop/builder', params: { productId: product.id } })}
                />
              ) : null}
            </Card>
          ) : match.isPending ? (
            <Skeleton className="h-14 w-full rounded-card" />
          ) : null}

          <Pressable
            onPress={() => setWatch({ productId: product.id, watching: !watching, alertEnabled: true, product })}
            accessibilityRole="button"
            accessibilityState={{ selected: watching }}
            accessibilityLabel={`${t(watching ? 'productDetail.watchAdded' : 'productDetail.watchAdd')}, ${t('productDetail.watchHint')}`}
            className="min-h-btn-primary flex-row items-center gap-3 rounded-card border border-line px-4 py-2 active:opacity-70"
          >
            <Icon icon={Bookmark} size={20} filled={watching} />
            <View className="flex-1">
              <Text variant="bodyMedium">{t(watching ? 'productDetail.watchAdded' : 'productDetail.watchAdd')}</Text>
              <Text variant="caption" tone="muted">
                {t('productDetail.watchHint')}
              </Text>
            </View>
          </Pressable>

          <Text variant="caption" tone="muted">
            {t('productDetail.paymentNote', { brand: suffixed(product.brandName, 'genitive', language) })}
          </Text>
        </View>
      </ScrollView>

      <BottomActionBar>
        <View className="flex-row items-center gap-3">
          {addedToWardrobe ? (
            <View
              className="h-btn-secondary flex-1 flex-row items-center justify-center gap-2 rounded-pill bg-sand px-3"
              accessible
              accessibilityLiveRegion="polite"
              accessibilityLabel={t('productDetail.addedToWardrobe')}
            >
              <Icon icon={Check} tone="accent" size={18} />
              <Text variant="caption" numberOfLines={2} className="flex-shrink">
                {t('productDetail.addedToWardrobe')}
              </Text>
            </View>
          ) : (
            <Button
              variant="secondary"
              className="flex-1"
              label={t('productDetail.addToWardrobe')}
              onPress={() =>
                requireSize((chosen) => {
                  addToWardrobe(product.id, chosen);
                  setAddedToWardrobe(true);
                })
              }
            />
          )}
          <Button
            className="flex-1"
            label={t('productDetail.addToCart')}
            onPress={() =>
              requireSize((chosen) => {
                addToCart([{ product, size: chosen }], 'product');
                router.push('/cart');
              })
            }
          />
        </View>
      </BottomActionBar>
    </>
  );
}

/**
 * 22 Ürün detayı — Ürün / Üzerimde toggle, size preselected from the body profile, wardrobe match,
 * "İzleme listeme ekle" (separate from the heart), "Gardıroba ekle" and "Sepete ekle". The note that
 * payment happens at the brand is always visible.
 */
export default function ProductScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const product = useProduct(id);

  return (
    <Screen bottom={product.data == null}>
      {product.data == null ? <ScreenHeader title={t('screens.product')} leading="back" /> : null}
      <ScreenState
        query={product}
        skeleton={<DetailSkeleton />}
        isEmpty={(data) => data === null}
        empty={{
          message: t('productDetail.notFound'),
          actionLabel: t('productDetail.notFoundAction'),
          onAction: () => router.dismissTo('/shop'),
        }}
      >
        {(data) => (data ? <ProductBody key={data.id} product={data} /> : null)}
      </ScreenState>
    </Screen>
  );
}
