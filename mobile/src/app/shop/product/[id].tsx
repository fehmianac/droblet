import { AiDropPulse, AiFailure, AiProgressLines, AiTryOnStage } from '@/components/ui/ai';
import { useQueryClient } from '@tanstack/react-query';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { BookmarkCheck, BookmarkPlus, Check, ChevronLeft, CircleAlert, Heart, Plus, ShoppingBag } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tryOnImageSource, viewerSourceOf } from '@/api/imageSources';
import { ONE_SIZE, type ProductDetail, type ProductSize } from '@/api/contracts/store';
import { useBodyProfile } from '@/api/profile';
import { BrandMark } from '@/components/blocks/BrandMark';
import { CartButton } from '@/components/blocks/SectionState';
import { AiBadge } from '@/components/ui/AiBadge';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Zoomable, type ViewerImage } from '@/components/ui/viewer';
import { toast } from '@/components/ui/toast';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useMyPhotos } from '@/features/account/queries';
import { CreditConfirmSheet } from '@/features/credits/CreditConfirmSheet';
import { openCreditSheetIfExhausted } from '@/features/credits/creditSheetStore';
import { aiCreditsKey } from '@/features/credits/useAiCredits';
import { preferredSize } from '@/features/store/cartMath';
import { HangerGlyph, MirrorGlyph } from '@/features/store/icons';
import { useAddItemFromProduct, useAddToCart, useSetFavorite, useSetWatch } from '@/features/store/mutations';
import {
  useFavoriteProducts,
  useProduct,
  useProductMatch,
  useProductTryOnJobId,
  useWatchlist,
} from '@/features/store/queries';
import { useGate } from '@/features/requirements/useRequirements';
import { ensureTryOnConsent, isConsentDeclined, TRY_ON_CREDIT_COST, useStartTryOn, useTryOnJob } from '@/features/tryon/api';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { formatMoney } from '@/lib/format';
import { suffixed } from '@/lib/trSuffix';
import { useIsOnline } from '@/sync/network';

type ProductView = 'product' | 'onMe';

/** Height of the image area on the board (it runs under the status bar). */
const HERO_CLASS = 'h-[390px]';

/** One side of the Ürün / Üzerimde switch: a borderless 36 chip inside the paper pill. */
function ViewOption({ label, selected, onPress, glyph }: { label: string; selected: boolean; onPress: () => void; glyph?: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      hitSlop={{ top: 4, bottom: 4 }}
      className={`h-chip flex-row items-center gap-1.5 rounded-pill px-[15px] active:opacity-80 ${selected ? 'bg-ink' : ''}`}
    >
      {glyph}
      <Text variant="chip" tone={selected ? 'cream' : 'ink'} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function ProductBody({ product }: { product: ProductDetail }) {
  const { t } = useTranslation();
  const language = useAppLanguage();
  const insets = useSafeAreaInsets();
  const client = useQueryClient();
  const online = useIsOnline();
  const focused = useIsFocused();

  const bodyProfile = useBodyProfile();
  const photos = useMyPhotos();
  const match = useProductMatch(product.id);
  const favorites = useFavoriteProducts();
  const watchlist = useWatchlist();
  const setFavorite = useSetFavorite();
  const setWatch = useSetWatch();
  const addToCart = useAddToCart();
  const addToWardrobe = useAddItemFromProduct();

  const [view, setView] = useState<ProductView>('product');
  const [pickedSize, setPickedSize] = useState<ProductSize | null>(null);
  const [sizeError, setSizeError] = useState(false);
  const [addedToWardrobe, setAddedToWardrobe] = useState(false);

  // "Üzerimde": the same job flow as every other try-on — confirm the credit, start the job, poll it.
  const tryOn = useStartTryOn();
  const [jobId, rememberJob] = useProductTryOnJobId(product.id);
  const job = useTryOnJob(jobId, { enabled: focused && view === 'onMe' });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tryOnNote, setTryOnNote] = useState<'offline' | 'failed' | null>(null);

  const settled = job.isDone || job.isFailed;
  useEffect(() => {
    // A finished image spent the credit; a failed job returned it.
    if (settled) void client.invalidateQueries({ queryKey: aiCreditsKey });
  }, [client, settled]);

  const profileSize = bodyProfile.data?.size ?? null;
  const defaultSize = preferredSize(product.sizes, profileSize);
  const size = pickedSize ?? defaultSize;
  const sizeIsFromProfile = pickedSize === null && defaultSize !== null && defaultSize === profileSize;

  const favorite = favorites.data?.productIds.includes(product.id) ?? false;
  const watching = watchlist.data?.items.some((i) => i.productId === product.id) ?? false;
  // Canvas 11: no usable picture (no body photo and the face path is not complete) → the requirements flow.
  const tryOnGate = useGate('tryOn', () => void ensureTryOnConsent().then((ok) => ok && setConfirmOpen(true)), { origin: product.name });
  const needsPhoto = photos.data !== undefined && photos.data.body.length === 0 && tryOnGate.req.choosePath;

  const startTryOn = async () => {
    try {
      const started = await tryOn.start({ kind: 'product', id: product.id });
      rememberJob(started.jobId);
      setTryOnNote(null);
      setView('onMe');
    } catch (error) {
      // Out of credits → the 05b sheet (never a silent failure); anything else → one calm sentence.
      if (!isConsentDeclined(error) && !openCreditSheetIfExhausted(error, 'product_try_on')) setTryOnNote('failed');
    } finally {
      setConfirmOpen(false);
    }
  };

  const showOnMe = () => {
    // An image (or a wait) from this session, or the "add a photo first" panel: nothing is spent.
    if (jobId || needsPhoto) {
      setTryOnNote(null);
      setView('onMe');
      return;
    }
    if (!online) {
      setTryOnNote('offline');
      return;
    }
    setTryOnNote(null);
    // What is missing first (requirements flow), then consent and the credit confirmation.
    tryOnGate.run();
  };

  const requireSize = (action: (chosen: ProductSize) => void) => {
    if (!size) {
      setSizeError(true);
      return;
    }
    action(size);
  };

  const garment = { category: product.category, color: product.colors[0], imageUrl: product.imageUrl };
  // 13a: the product photo and, once there is one, the AI image of it on the user page together.
  const onMeImage = tryOnImageSource(view === 'onMe' && job.isDone ? job.result : null);
  const onMeViewer = viewerSourceOf(onMeImage);
  const viewerImages: ViewerImage[] = [
    ...(product.imageUrl ? [{ uri: product.imageUrl, label: product.name }] : []),
    ...(onMeViewer ? [{ ...onMeViewer, label: t('productDetail.onMeA11y', { name: product.name }), ai: { tag: t('aiBadge.onYou') } }] : []),
  ];
  let onMe: ReactNode = null;
  if (view === 'onMe') {
    if (needsPhoto) {
      onMe = (
        <View className="flex-1 items-center justify-center gap-3 bg-sand px-4">
          <Text variant="caption" className="text-center">
            {tryOnGate.hint ?? t('productDetail.tryOnNeedsPhoto')}
          </Text>
          <Button variant="secondary" label={t('productDetail.tryOnAddPhoto')} onPress={tryOnGate.run} className="px-4" testID="product-try-on-photo" />
        </View>
      );
    } else if (job.isFailed) {
      onMe = (
        <View className="flex-1 justify-center bg-sand px-3">
          <AiFailure layout="inline" creditRefunded={job.creditRefunded} onRetry={() => void startTryOn()} retrying={tryOn.isStarting} />
        </View>
      );
    } else if (job.isDone) {
      const uri = onMeImage.uri;
      // The marker only sits on a generated image. A finished job without one shows the piece itself
      // ("Parça kolajı"), never a bare figure under "SENİN ÜZERİNDE".
      onMe = (
        <Zoomable images={viewerImages} index={viewerImages.length - 1} disabled={!uri} className="flex-1" testID="product-onme-zoom">
        <ImageSlot
          fit="contain"
          {...onMeImage}
          className="flex-1"
          accessibilityLabel={uri ? t('productDetail.onMeA11y', { name: product.name }) : t('aiBadge.collageA11y', { name: product.name })}
          placeholder={{ kind: 'look', pieces: [garment], figureHeight: 220 }}
        >
          {uri ? (
            <View className="absolute bottom-2 left-2" pointerEvents="none">
              <AiBadge kind="onYou" />
            </View>
          ) : (
            <View className="absolute left-2.5 h-badge justify-center rounded-pill border border-line bg-paper px-2" style={{ top: insets.top + 56 }} pointerEvents="none">
              <Text variant="badge" numberOfLines={1}>
                {t('stylistResult.collageBadge')}
              </Text>
            </View>
          )}
        </ImageSlot>
        </Zoomable>
      );
    } else {
      // The shared AI wait (canvas `AiYukleniyor`): the try-on stage here, the progress sentences under the image.
      onMe = <AiTryOnStage className="flex-1" pieces={1} tag={null} />;
    }
  }
  const waiting = view === 'onMe' && !needsPhoto && Boolean(jobId) && job.isWorking;

  return (
    <>
      <ScrollView contentContainerClassName="gap-[11px] pb-6" bounces={false}>
        <View className={HERO_CLASS}>
          <View className="flex-1 flex-row gap-0.5">
            <Zoomable images={viewerImages} index={0} disabled={!product.imageUrl} accessibilityLabel={product.name} className="flex-1" testID="product-image-zoom">
              <ImageSlot
                uri={product.imageUrl}
                className="flex-1"
                accessibilityLabel={product.name}
                placeholder={{ kind: 'garment', category: garment.category, color: garment.color, glyphSize: 96 }}
              />
            </Zoomable>
            {onMe}
          </View>
          <View className="absolute left-gutter right-gutter flex-row justify-between" style={{ top: insets.top + 4 }}>
            <IconButton icon={ChevronLeft} variant="inverse" onPress={() => router.back()} accessibilityLabel={t('a11y.back')} />
            <View className="flex-row gap-2">
              <CartButton variant="inverse" />
              <IconButton
                icon={Heart}
                variant="inverse"
                active={favorite}
                onPress={() => setFavorite(product.id, !favorite)}
                accessibilityLabel={t(favorite ? 'shop.favoriteRemove' : 'shop.favoriteAdd')}
                testID="product-favorite"
              />
            </View>
          </View>
          <View className="absolute bottom-3.5 left-0 right-0 items-center" pointerEvents="box-none">
            <View
              className="flex-row gap-0.5 rounded-[22px] bg-paper p-1 shadow-md"
              accessibilityRole="tablist"
              accessibilityLabel={t('productDetail.viewToggle')}
            >
              <ViewOption label={t('productDetail.viewProduct')} selected={view === 'product'} onPress={() => setView('product')} />
              <ViewOption
                label={t('productDetail.viewOnMe')}
                selected={view === 'onMe'}
                onPress={showOnMe}
                glyph={<MirrorGlyph tone={view === 'onMe' ? 'cream' : 'ink'} />}
              />
            </View>
          </View>
        </View>

        <View className="gap-[11px] px-gutter pt-[3px]">
          {waiting ? (
            <View className="flex-row items-center gap-2.5">
              <AiDropPulse height={18} />
              <View className="flex-1">
                <AiProgressLines
                  lines={[t('ai.tryOnLines.pieces'), t('ai.tryOnLines.colors'), t('ai.tryOnLines.placing'), t('ai.tryOnLines.finishing')]}
                  size="compact"
                />
              </View>
            </View>
          ) : null}
          {tryOnNote ? (
            <View className="flex-row items-start gap-1.5" accessibilityLiveRegion="polite">
              <Icon icon={CircleAlert} size={14} tone="danger" />
              <Text variant="caption" tone="danger" className="flex-1">
                {t(tryOnNote === 'offline' ? 'productDetail.tryOnOffline' : 'productDetail.tryOnStartFailed')}
              </Text>
            </View>
          ) : null}

          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1 gap-1">
              <BrandMark name={product.brandName} logoUrl={product.brandLogoUrl} />
              <Text variant="h2" className="text-[24px] leading-[27px]">
                {product.name}
              </Text>
            </View>
            {product.price !== null ? (
              <Text variant="total" className="mt-1.5 text-[18px]">
                {formatMoney(product.price)}
              </Text>
            ) : null}
          </View>

          <View className="gap-1.5">
            <View className="flex-row flex-wrap items-baseline gap-1">
              <Text variant="label">{t('productDetail.sizeLabel')}</Text>
              {sizeIsFromProfile ? (
                <Text variant="caption" tone="muted">
                  {t('productDetail.sizeFromProfile')}
                </Text>
              ) : null}
            </View>
            <View className="flex-row flex-wrap gap-1.5" accessibilityRole="radiogroup" accessibilityLabel={t('productDetail.sizeLabel')}>
              {product.sizes.map((s) => {
                const label = s === ONE_SIZE ? t('shop.oneSize') : s;
                const selected = size === s;
                return (
                  <Pressable
                    key={s}
                    onPress={() => {
                      setPickedSize(s);
                      setSizeError(false);
                    }}
                    accessibilityRole="radio"
                    accessibilityLabel={label}
                    accessibilityState={{ selected, checked: selected }}
                    hitSlop={{ top: 4, bottom: 4 }}
                    className={`h-chip min-w-[46px] items-center justify-center rounded-pill border px-2.5 active:opacity-80 ${
                      selected ? 'border-ink bg-ink' : 'border-line'
                    }`}
                  >
                    <Text variant="chip" tone={selected ? 'cream' : 'ink'} numberOfLines={1}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
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
            <View className="min-h-16 flex-row items-center gap-2.5 rounded-image-lg border border-line bg-paper px-3 py-2.5">
              <HangerGlyph size={18} />
              <Text variant="caption" className="flex-1">
                {match.data.count > 0 ? (
                  <Trans
                    i18nKey="productDetail.matchCount"
                    count={match.data.count}
                    components={{ b: <Text variant="label" /> }}
                  />
                ) : (
                  t('productDetail.matchNone')
                )}
              </Text>
              {match.data.count > 0 ? (
                <Pressable
                  onPress={() => router.push({ pathname: '/shop/builder', params: { productId: product.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={t('productDetail.matchShow')}
                  hitSlop={8}
                  className="min-h-icon-btn justify-center active:opacity-70"
                >
                  <Text variant="label">{t('productDetail.matchShow')}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : match.isPending ? (
            <Skeleton className="h-16 w-full rounded-image-lg" />
          ) : null}

          <Pressable
            onPress={() => {
              setWatch({ productId: product.id, watching: !watching, alertEnabled: true, product });
              // 13b: the segment flips too, but the toast also says where the product went.
              if (watching) toast.success(t('feedback.watch.removed'), { testID: 'toast-watch' });
              else toast.success(t('feedback.watch.added'), { action: { label: t('feedback.see'), onPress: () => router.push('/watchlist') }, testID: 'toast-watch' });
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: watching }}
            accessibilityLabel={`${t(watching ? 'productDetail.watchAdded' : 'productDetail.watchAdd')}, ${t('productDetail.watchHint')}`}
            className="min-h-icon-btn flex-row items-center gap-2.5 rounded-image-lg border border-line px-3 py-2.5 active:opacity-70"
          >
            <Icon icon={watching ? BookmarkCheck : BookmarkPlus} size={18} />
            <View className="flex-1">
              <Text variant="segment">{t(watching ? 'productDetail.watchAdded' : 'productDetail.watchAdd')}</Text>
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
        <View className="flex-row items-center gap-2.5">
          {addedToWardrobe ? (
            <View
              className="h-btn-bar flex-1 flex-row items-center justify-center gap-2 rounded-pill bg-sand px-3"
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
              size="bar"
              icon={Plus}
              className="flex-1 px-3"
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
            size="bar"
            icon={ShoppingBag}
            className="flex-1 px-3"
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

      <CreditConfirmSheet
        visible={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        cost={TRY_ON_CREDIT_COST}
        onConfirm={() => void startTryOn()}
        confirming={tryOn.isStarting}
      />
    </>
  );
}

/**
 * 22 Ürün + üzerimde — the image runs to the top edge with the back / cart / heart buttons on it and
 * the Ürün / Üzerimde switch at its foot. "Üzerimde" splits the image: the product on the left, the
 * AI image ("SENİN ÜZERİNDE") on the right — started through the credit confirmation and the shared
 * try-on job. Below: size (preselected from the body profile), the wardrobe match, "İzleme listeme
 * ekle" (separate from the heart) and the note that payment happens at the brand. Bottom bar:
 * "Gardıroba ekle" and "Sepete ekle" — no bottom menu.
 */
export default function ProductScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const product = useProduct(id);
  const loaded = product.data != null;

  return (
    <Screen top={!loaded}>
      {loaded ? null : <ScreenHeader title={t('screens.product')} leading="back" />}
      <ScreenState
        query={product}
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
