import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { ChevronRight, Search } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, useWindowDimensions, View } from 'react-native';

import type { CreatorCard, WeeklyEditSummary } from '@/api/contracts/store';
import { CartButton, SectionState } from '@/components/blocks/SectionState';
import { Logo } from '@/components/brand/Logo';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Screen } from '@/components/ui/Screen';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useSegment } from '@/features/segment/store';
import { CreatorCardView } from '@/features/store/CreatorCardView';
import { DiscoverShelf, discoverShelfCategories } from '@/features/store/DiscoverShelf';
import { useSetFavorite } from '@/features/store/mutations';
import { EMPTY_PRODUCT_QUERY, useBrands, useCreators, useCurrentEdit, useFavoriteProducts, useProducts, useSeriesOutfits } from '@/features/store/queries';
import { ShopProductCard } from '@/features/store/ShopProductCard';
import { useTeenRules } from '@/features/teen/store';
import { useWeeklyEdit } from '@/features/today/api';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { formatDate, formatIsoDateRange, parseLocalDate } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';
import { inkFade, placeholderTones } from '@/theme/tokens';
import { useThemeColors } from '@/theme/useThemeColors';

type DiscoverSection = 'all' | 'editor' | 'influencer' | 'series';

/** Products shown on "Tümü": the newest of the catalogue, two columns; the rest is one tap away in the store. */
const ALL_PRODUCT_COUNT = 8;

function CreatorStripSkeleton() {
  return (
    <View className="flex-row gap-2.5 px-gutter">
      {[0, 1, 2].map((i) => (
        <View key={i} className="w-[132px] gap-1.5">
          <Skeleton className="h-[170px] w-full rounded-image-lg" />
          <Skeleton className="h-4 w-24 rounded-field" />
        </View>
      ))}
    </View>
  );
}

function CreatorGrid({ creators }: { creators: CreatorCard[] }) {
  const rows: CreatorCard[][] = [];
  for (let i = 0; i < creators.length; i += 2) rows.push(creators.slice(i, i + 2));
  return (
    <View className="gap-5 px-gutter">
      {rows.map((row) => (
        <View key={row[0]?.id} className="flex-row gap-3">
          {row.map((c) => (
            <CreatorCardView key={c.id} creator={c} className="flex-1" />
          ))}
          {row.length === 1 ? <View className="flex-1" /> : null}
        </View>
      ))}
    </View>
  );
}

/**
 * The weekly edit cover of 20: a 290-high photograph (radius 20) with the eyebrow, the serif title and
 * the meta line set on an ink fade at its foot. Opens the edit (20b).
 */
function EditCover({ edit, teen = false }: { edit: WeeklyEditSummary; teen?: boolean }) {
  const language = useAppLanguage();
  const { t } = useTranslation();
  const eyebrow = t('explore.editEyebrow', {
    range: toDisplayUpper(formatIsoDateRange(edit.startDate, edit.endDate), language),
  });
  // Canvas 18 · 20: a teen's cover leaves out "senin üzerinde" (try-on may be closed for them).
  const meta = teen ? t('teen.discover.editMeta', { count: edit.lookCount }) : t('explore.editMeta', { count: edit.lookCount });
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/edit/[id]', params: { id: edit.id } })}
      accessibilityRole="button"
      accessibilityLabel={[eyebrow, edit.title, meta].join(', ')}
      className="mx-gutter h-[290px] items-center justify-center overflow-hidden rounded-card active:opacity-90"
      style={{ backgroundColor: placeholderTones.dark }}
    >
      <ImageSlot uri={edit.imageUrl} className="absolute inset-0" placeholder={{ kind: 'figure', tone: 'dark', figureHeight: 180 }} />
      <LinearGradient colors={[inkFade.clear, inkFade.deep]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 18 }}>
        <Text variant="eyebrow" tone="cream">
          {eyebrow}
        </Text>
        <Text variant="h2" tone="cream" className="mt-1.5 text-[28px] leading-[30px]" numberOfLines={2}>
          {edit.title}
        </Text>
        <Text variant="chip" tone="cream" className="mt-1.5">
          {meta}
        </Text>
      </LinearGradient>
    </Pressable>
  );
}

/** One look of the week: day · occasion over the name, opening the edit at that look. */
function TeenEdit({ summary }: { summary: WeeklyEditSummary }) {
  const { t } = useTranslation();
  const language = useAppLanguage();
  const editId = summary.id;
  const edit = useWeeklyEdit(editId);
  const looks = edit.data?.looks ?? [];
  // A sponsored edit is advertising: not shown to a teen (the server leaves it out too).
  if (edit.data?.sponsoredBy) {
    return (
      <Text variant="body" tone="muted" className="px-gutter py-10 text-center" testID="discover.teen.sponsored">
        {t('explore.editEmpty')}
      </Text>
    );
  }
  return (
    <>
      <EditCover edit={summary} teen />
      <View className="px-gutter" testID="discover.teen.looks">
        <Text variant="h3" className="mb-1.5">
          {t('teen.discover.weekLooks')}
        </Text>
        {looks.map((look, i) => {
          const day = toDisplayUpper(formatDate(parseLocalDate(look.date), { weekday: 'long' }), language);
          const eyebrow = `${day} · ${toDisplayUpper(t(`occasion.${look.occasion}`), language)}`;
          return (
            <Pressable
              key={look.id}
              onPress={() => router.push({ pathname: '/edit/[id]', params: { id: editId, look: look.id } })}
              accessibilityRole="button"
              accessibilityLabel={`${eyebrow}, ${look.name}`}
              className="min-h-16 flex-row items-center gap-3 border-t border-line py-2 active:opacity-80"
              testID={`discover.teen.look.${i}`}
            >
              <ImageSlot uri={look.tryOnImageUrl} className="h-12 w-12 rounded-thumb" placeholder={{ kind: 'look', pieces: [], seed: look.id }} />
              <View className="min-w-0 flex-1">
                <Text variant="eyebrow" numberOfLines={1}>
                  {eyebrow}
                </Text>
                <Text variant="bodyMedium" className="mt-0.5" numberOfLines={1}>
                  {look.name}
                </Text>
              </View>
              <Icon icon={ChevronRight} size={16} />
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

/**
 * 20 Keşfet · genç (canvas 18): safe content only — the logo header without search or cart, no chips, the weekly edit
 * cover (a sponsored edit is not shown) and that week's looks as a list, then one sentence on why. No creators, no
 * store, no friends.
 */
function TeenDiscover() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const edit = useCurrentEdit();
  return (
    <Screen>
      <View className="h-12 flex-row items-center px-gutter">
        <Logo />
      </View>
      <ScreenState
        query={edit}
        isEmpty={(data) => data === null}
        empty={{ message: t('explore.editEmpty'), actionLabel: t('teen.locked.wardrobe'), onAction: () => router.navigate('/wardrobe') }}
      >
        {(data) =>
          data ? (
            <ScrollView
              contentContainerClassName="gap-4 pb-8 pt-1.5"
              refreshControl={<RefreshControl refreshing={edit.isRefetching} onRefresh={() => void edit.refetch()} tintColor={colors.muted} />}
              testID="discover.teen"
            >
              <TeenEdit summary={data} />
              <Text variant="caption" tone="muted" className="px-gutter" testID="discover.teen.note">
                {t('teen.discover.note')}
              </Text>
            </ScrollView>
          ) : null
        }
      </ScreenState>
    </Screen>
  );
}

/**
 * 20 Keşfet — the logo header with search and the cart (count dot), the chips (Editör · Mağaza ·
 * Influencer · Arkadaşlar · Dizi outfitleri), the weekly edit cover and the creator looks strip (with
 * the "SPONSORLU" tag). Mağaza and Arkadaşlar open their own screens (21, 25); "Tümü" opens the feed (25).
 */
export default function DiscoverTab() {
  const teen = useTeenRules().isTeen;
  return teen ? <TeenDiscover /> : <AdultDiscover />;
}

function AdultDiscover() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  // Opens on "Tümü" (owner decision 2026-11-23): everything there is — the edit, the store's newest products, the
  // creators — and the chips narrow it down.
  const [section, setSection] = useState<DiscoverSection>('all');
  const { width } = useWindowDimensions();
  const edit = useCurrentEdit();
  const creators = useCreators();
  // "Mağazadan" can be narrowed to one brand (owner request): the chips list the catalogue's brands.
  const [brandId, setBrandId] = useState<string | null>(null);
  const brands = useBrands();
  const productQuery = useMemo(() => (brandId ? { ...EMPTY_PRODUCT_QUERY, brandIds: [brandId] } : EMPTY_PRODUCT_QUERY), [brandId]);
  const products = useProducts(productQuery, section === 'all');
  const favorites = useFavoriteProducts();
  const setFavorite = useSetFavorite();
  const favoriteIds = favorites.data?.productIds ?? [];
  const newest = (products.data?.pages[0]?.items ?? []).slice(0, ALL_PRODUCT_COUNT);
  const cardWidth = (width - 20 * 2 - 12) / 2;
  const allLoading = edit.isPending || products.isPending;
  const allEmpty = !allLoading && !edit.data && newest.length === 0 && brandId === null && (creators.data?.length ?? 0) === 0;
  const series = useSeriesOutfits(section === 'series');
  // Under the newest products: a shelf per kind (coats, jackets, …), narrowed by the same brand chip.
  const shelves = discoverShelfCategories(useSegment());

  const refresh = () => {
    void edit.refetch();
    void creators.refetch();
    if (section === 'all') void products.refetch();
  };

  return (
    <Screen>
      <View className="h-12 flex-row items-center justify-between px-gutter">
        <Logo />
        <View className="flex-row gap-2">
          <IconButton icon={Search} onPress={() => router.push('/shop')} accessibilityLabel={t('explore.search')} testID="discover.search" />
          <CartButton testID="discover.cart" />
        </View>
      </View>
      <View className="pt-0.5">
        <ChipRow>
          <Chip testID="discover.chip.all" label={t('discover.chipAll')} selected={section === 'all'} onPress={() => setSection('all')} />
          <Chip testID="discover.chip.editor" label={t('discover.chipEditor')} selected={section === 'editor'} onPress={() => setSection('editor')} />
          <Chip testID="discover.chip.shop" label={t('discover.chipShop')} onPress={() => router.push('/shop')} />
          <Chip
            testID="discover.chip.influencer"
            label={t('discover.chipInfluencer')}
            selected={section === 'influencer'}
            onPress={() => setSection('influencer')}
          />
          <Chip testID="discover.chip.friends" label={t('discover.chipFriends')} onPress={() => router.push('/friends/feed')} />
          <Chip testID="discover.chip.series" label={t('discover.chipSeries')} selected={section === 'series'} onPress={() => setSection('series')} />
        </ChipRow>
      </View>

      {section === 'all' ? (
        allEmpty ? (
          <ScreenState
            query={edit}
            isEmpty={() => true}
            empty={{ message: t('discover.allEmpty'), actionLabel: t('explore.editEmptyAction'), onAction: () => router.push('/shop') }}
          >
            {() => null}
          </ScreenState>
        ) : (
          <ScrollView
            contentContainerClassName="gap-6 pb-8 pt-2.5"
            refreshControl={<RefreshControl refreshing={edit.isRefetching || products.isRefetching} onRefresh={refresh} tintColor={colors.muted} />}
            testID="discover.all"
          >
            {edit.data ? <EditCover edit={edit.data} /> : null}

            {allLoading || newest.length > 0 || brandId !== null ? (
              <View className="gap-3.5">
                <View className="flex-row items-center justify-between px-gutter">
                  <Text variant="h3">{t('discover.fromStore')}</Text>
                  <Pressable
                    onPress={() => router.push(brandId ? { pathname: '/shop', params: { brand: brandId } } : '/shop')}
                    accessibilityRole="link"
                    accessibilityLabel={t('discover.fromStoreAll')}
                    hitSlop={8}
                    className="min-h-icon-btn flex-row items-center gap-0.5 active:opacity-70"
                    testID="discover.all.store"
                  >
                    <Text variant="label">{t('common.seeAll')}</Text>
                    <Icon icon={ChevronRight} size={14} />
                  </Pressable>
                </View>
                {(brands.data?.length ?? 0) > 1 || brandId !== null ? (
                  <ChipRow>
                    <Chip testID="discover.all.brand.all" label={t('discover.allBrands')} selected={brandId === null} onPress={() => setBrandId(null)} />
                    {(brands.data ?? []).map((brand) => (
                      <Chip
                        key={brand.id}
                        testID={`discover.all.brand.${brand.id}`}
                        label={brand.name}
                        selected={brandId === brand.id}
                        onPress={() => setBrandId(brand.id)}
                      />
                    ))}
                  </ChipRow>
                ) : null}
                {newest.length > 0 ? (
                  <View className="flex-row flex-wrap gap-3 px-gutter">
                    {newest.map((item, index) => (
                      <View key={item.id} style={{ width: cardWidth }}>
                        <ShopProductCard
                          testID={`discover.all.product.${index}`}
                          product={item}
                          favorite={favoriteIds.includes(item.id)}
                          onToggleFavorite={() => setFavorite(item.id, !favoriteIds.includes(item.id))}
                          onPress={() => router.push({ pathname: '/shop/product/[id]', params: { id: item.id } })}
                        />
                      </View>
                    ))}
                  </View>
                ) : products.isFetching ? (
                  <View className="flex-row gap-3 px-gutter">
                    <Skeleton className="h-[240px] flex-1 rounded-image-lg" />
                    <Skeleton className="h-[240px] flex-1 rounded-image-lg" />
                  </View>
                ) : (
                  <Text variant="caption" tone="muted" className="px-gutter" testID="discover.all.brandEmpty">
                    {t('discover.brandEmpty')}
                  </Text>
                )}
              </View>
            ) : null}

            {shelves.map((category) => (
              <DiscoverShelf key={category} category={category} brandId={brandId} enabled={section === 'all'} />
            ))}

            {(creators.data?.length ?? 0) > 0 ? (
              <View className="gap-4">
                <Text variant="h3" className="px-gutter">
                  {t('explore.creatorLooks')}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2.5 px-gutter">
                  {(creators.data ?? []).map((c) => (
                    <CreatorCardView key={c.id} creator={c} />
                  ))}
                </ScrollView>
              </View>
            ) : null}
          </ScrollView>
        )
      ) : null}

      {section === 'editor' ? (
        <ScreenState
          query={edit}
          isEmpty={(data) => data === null}
          empty={{ message: t('explore.editEmpty'), actionLabel: t('explore.editEmptyAction'), onAction: () => router.push('/shop') }}
        >
          {(data) =>
            data ? (
              <ScrollView
                contentContainerClassName="gap-4 pb-8 pt-2.5"
                refreshControl={<RefreshControl refreshing={edit.isRefetching} onRefresh={refresh} tintColor={colors.muted} />}
              >
                <EditCover edit={data} />

                <View className="gap-4">
                  <View className="flex-row items-center justify-between px-gutter">
                    <Text variant="h3">{t('explore.creatorLooks')}</Text>
                    <Pressable
                      onPress={() => router.push('/friends/feed')}
                      accessibilityRole="link"
                      accessibilityLabel={t('explore.creatorLooksAll')}
                      hitSlop={8}
                      className="min-h-icon-btn flex-row items-center gap-0.5 active:opacity-70"
                    >
                      <Text variant="label">{t('common.seeAll')}</Text>
                      <Icon icon={ChevronRight} size={14} />
                    </Pressable>
                  </View>
                  <SectionState
                    query={creators}
                    skeleton={<CreatorStripSkeleton />}
                    isEmpty={(list) => list.length === 0}
                    emptyText={t('explore.creatorsEmpty')}
                  >
                    {(list) => (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2.5 px-gutter">
                        {list.map((c) => (
                          <CreatorCardView key={c.id} creator={c} />
                        ))}
                      </ScrollView>
                    )}
                  </SectionState>
                </View>
              </ScrollView>
            ) : null
          }
        </ScreenState>
      ) : null}

      {section === 'influencer' ? (
        <ScreenState
          query={creators}
          isEmpty={(list) => list.length === 0}
          empty={{
            message: t('explore.creatorsEmpty'),
            actionLabel: t('explore.creatorsEmptyAction'),
            onAction: () => router.push('/friends/find'),
          }}
        >
          {(list) => (
            <ScrollView
              contentContainerClassName="pb-8 pt-3"
              refreshControl={
                <RefreshControl refreshing={creators.isRefetching} onRefresh={() => void creators.refetch()} tintColor={colors.muted} />
              }
            >
              <CreatorGrid creators={list} />
            </ScrollView>
          )}
        </ScreenState>
      ) : null}

      {section === 'series' ? (
        <ScreenState
          query={series}
          isEmpty={(list) => list.length === 0}
          empty={{ message: t('explore.seriesEmpty'), actionLabel: t('explore.seriesEmptyAction'), onAction: () => setSection('all') }}
        >
          {(list) => (
            <ScrollView contentContainerClassName="gap-5 px-gutter pb-8 pt-3">
              {list.map((outfit) => (
                <View key={outfit.id} className="gap-2">
                  <ImageSlot
                    uri={outfit.imageUrl}
                    className="aspect-[4/5] w-full rounded-image-lg"
                    accessibilityLabel={outfit.title}
                    placeholder={{ kind: 'look', pieces: [], seed: outfit.id }}
                  />
                  <Text variant="caption" tone="muted">
                    {outfit.seriesName}
                  </Text>
                  <Text variant="bodyMedium">{outfit.title}</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </ScreenState>
      ) : null}
    </Screen>
  );
}

/** A render error in this tab shows the error state with "Tekrar dene"; the tab bar and the other tabs keep working. */
export { ScreenErrorBoundary as ErrorBoundary } from '@/components/ScreenErrorBoundary';
