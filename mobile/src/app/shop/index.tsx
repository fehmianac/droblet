import type { Item } from '@/api/contracts/wardrobe';
import { ItemThumb } from '@/features/wardrobe/ItemThumb';
import { itemImage } from '@/features/wardrobe/parts';
import { useItems } from '@/features/wardrobe/queries';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowUpDown, Puzzle, Shirt, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import {
  CATALOG_COLORS,
  type CatalogColor,
  type ProductCategory,
  type ProductQuery,
  type ProductSummary,
} from '@/api/contracts/store';
import { useBodyProfile } from '@/api/profile';
import { Card, SearchField } from '@/components/blocks/basics';
import { CartButton, SectionState } from '@/components/blocks/SectionState';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateMessage } from '@/components/ui/StateMessage';
import { Text } from '@/components/ui/Text';
import { FilterSheet, filterCount, type FilterKind } from '@/features/store/FilterSheet';
import { useSetFavorite } from '@/features/store/mutations';
import { ShopProductCard } from '@/features/store/ShopProductCard';
import {
  EMPTY_PRODUCT_QUERY,
  useCompleteSuggestions,
  useFavoriteProducts,
  useProducts,
} from '@/features/store/queries';
import { useThemeColors } from '@/theme/useThemeColors';

/** The category chips of the design, in order. Shoes and bags are reached through search and the builder. */
const CHIP_CATEGORIES: ProductCategory[] = ['tshirt', 'shirt', 'knit', 'jacket', 'trousers', 'dress', 'accessory'];

function parseColors(param: string | undefined): CatalogColor[] {
  if (!param) return [];
  const known = CATALOG_COLORS as readonly string[];
  return param.split(',').filter((c): c is CatalogColor => known.includes(c));
}

function SkeletonCard() {
  return (
    <View className="w-1/2 gap-2 px-1.5">
      <Skeleton className="aspect-[4/5] w-full rounded-image-lg" />
      <Skeleton className="h-3 w-16 rounded-field" />
      <Skeleton className="h-4 w-28 rounded-field" />
      <Skeleton className="h-4 w-14 rounded-field" />
    </View>
  );
}

function GridSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <View className="gap-5">
      {Array.from({ length: rows }, (_, row) => (
        <View key={row} className="flex-row">
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ))}
    </View>
  );
}

function Shortcut({ icon, label, onPress }: { icon: typeof Shirt; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} className="flex-1 active:opacity-80">
      <Card className="min-h-16 flex-row items-center gap-3 p-3.5">
        <View className="h-9 w-9 items-center justify-center rounded-pill bg-sand">
          <Icon icon={icon} size={18} tone="accent" />
        </View>
        <Text variant="bodyMedium" className="flex-1">
          {label}
        </Text>
      </Card>
    </Pressable>
  );
}

/**
 * 21 Stil mağazası — search, the Kombin oluşturucu / Parçamı tamamla shortcuts, category chips,
 * Marka · Renk · Beden filter sheets + sort, and a 2-column infinite grid with skeleton cards.
 * `?colors=a,b` preselects colour filters ("Paletime uygun ürünler" from 30).
 */
export default function ShopScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ colors?: string }>();
  const bodyProfile = useBodyProfile();
  const profileSize = bodyProfile.data?.size ?? null;

  const [query, setQuery] = useState<ProductQuery>(() => ({ ...EMPTY_PRODUCT_QUERY, colors: parseColors(params.colors) }));
  const [search, setSearch] = useState('');
  const [sheet, setSheet] = useState<FilterKind | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeFor, setCompleteFor] = useState<Item | null>(null);

  // Search as you type, but only ask the catalogue once typing pauses.
  useEffect(() => {
    const handle = setTimeout(() => setQuery((q) => (q.q === search ? q : { ...q, q: search })), 300);
    return () => clearTimeout(handle);
  }, [search]);

  const products = useProducts(query, completeFor === null);
  const complete = useCompleteSuggestions(completeFor?.id ?? null);
  const wardrobe = useItems({ enabled: completeOpen });
  const favorites = useFavoriteProducts();
  const setFavorite = useSetFavorite();
  const favoriteIds = favorites.data?.productIds ?? [];

  const items: ProductSummary[] | undefined = completeFor
    ? complete.data?.products
    : products.data?.pages.flatMap((page) => page.items);
  const active = completeFor ? complete : products;
  const filtered =
    query.categories.length + query.brandIds.length + query.colors.length + query.sizes.length > 0 || query.q !== '';

  const clearFilters = () => {
    setSearch('');
    setQuery(EMPTY_PRODUCT_QUERY);
    setCompleteFor(null);
  };

  const filterChip = (kind: Exclude<FilterKind, 'sort'>, label: string) => {
    const count = filterCount(query, kind);
    return (
      <Chip
        label={count > 0 ? t('shop.filterWithCount', { label, count }) : label}
        selected={count > 0}
        onPress={() => setSheet(kind)}
      />
    );
  };

  const header = (
    <View className="gap-4 pb-4">
      <View className="gap-4 px-gutter">
        <SearchField
          value={search}
          onChangeText={setSearch}
          label={t('shop.searchLabel')}
          placeholder={t('shop.searchPlaceholder')}
          clearLabel={t('shop.clearSearch')}
        />
        <View className="flex-row gap-3">
          <Shortcut icon={Shirt} label={t('shop.builderShortcut')} onPress={() => router.push('/shop/builder')} />
          <Shortcut icon={Puzzle} label={t('shop.completeShortcut')} onPress={() => setCompleteOpen(true)} />
        </View>
      </View>

      {completeFor ? (
        <View className="flex-row items-center gap-2 px-gutter">
          <View className="h-chip flex-1 flex-row items-center rounded-pill bg-ink px-4">
            <Text variant="bodyMedium" tone="paper" numberOfLines={1}>
              {t('shop.completeFor', { name: completeFor.name })}
            </Text>
          </View>
          <Pressable
            onPress={() => setCompleteFor(null)}
            accessibilityRole="button"
            accessibilityLabel={t('shop.completeClear')}
            className="h-icon-btn w-icon-btn items-center justify-center rounded-pill border border-line bg-paper"
          >
            <Icon icon={X} size={18} />
          </Pressable>
        </View>
      ) : (
        <>
          <ChipRow>
            <Chip
              label={t('shop.category.all')}
              selected={query.categories.length === 0}
              onPress={() => setQuery((q) => ({ ...q, categories: [] }))}
            />
            {CHIP_CATEGORIES.map((c) => (
              <Chip
                key={c}
                label={t(`shop.category.${c}`)}
                selected={query.categories.length === 1 && query.categories[0] === c}
                onPress={() => setQuery((q) => ({ ...q, categories: [c] }))}
              />
            ))}
          </ChipRow>
          <View className="flex-row items-center gap-2 px-gutter">
            {filterChip('brand', t('shop.filterBrand'))}
            {filterChip('color', t('shop.filterColor'))}
            {filterChip('size', t('shop.filterSize'))}
            <View className="flex-1" />
            <Pressable
              onPress={() => setSheet('sort')}
              accessibilityRole="button"
              accessibilityLabel={t('shop.sortA11y', { sort: t(`shop.sort.${query.sort}`) })}
              className="min-h-icon-btn flex-row items-center gap-1.5 active:opacity-70"
            >
              <Icon icon={ArrowUpDown} size={16} tone="muted" />
              <Text variant="caption" tone="muted">
                {t(`shop.sort.${query.sort}`)}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );

  return (
    <Screen bottom>
      <ScreenHeader title={t('screens.shop')} leading="back" right={<CartButton />} />
      <OfflineBanner />
      <FlatList
        data={items ?? []}
        keyExtractor={(item) => item.id}
        numColumns={2}
        ListHeaderComponent={header}
        contentContainerClassName="gap-5 pb-8"
        columnWrapperClassName="px-[14px]"
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (!completeFor && products.hasNextPage && !products.isFetchingNextPage) void products.fetchNextPage();
        }}
        refreshControl={
          <RefreshControl
            refreshing={active.isRefetching && !products.isFetchingNextPage}
            onRefresh={() => void active.refetch()}
            tintColor={colors.muted}
          />
        }
        renderItem={({ item }) => (
          <View className="w-1/2 px-1.5">
            <ShopProductCard
              product={item}
              favorite={favoriteIds.includes(item.id)}
              onToggleFavorite={() => setFavorite(item.id, !favoriteIds.includes(item.id))}
              onPress={() => router.push({ pathname: '/shop/product/[id]', params: { id: item.id } })}
            />
          </View>
        )}
        ListEmptyComponent={
          <SectionState
            query={{ data: items, status: active.status, fetchStatus: active.fetchStatus, error: active.error, refetch: active.refetch }}
            skeleton={
              <View className="px-[14px]">
                <GridSkeleton />
              </View>
            }
          >
            {() => (
              <StateMessage
                message={t('shop.empty')}
                actionLabel={filtered || completeFor ? t('shop.emptyAction') : undefined}
                onAction={clearFilters}
              />
            )}
          </SectionState>
        }
        ListFooterComponent={
          products.isFetchingNextPage ? (
            <View className="px-[14px]" accessible accessibilityLabel={t('a11y.loading')}>
              <GridSkeleton rows={1} />
            </View>
          ) : products.isFetchNextPageError ? (
            <View className="items-center gap-1 px-gutter">
              <Text variant="caption" tone="muted">
                {t('shop.loadMoreFailed')}
              </Text>
              <Button variant="text" label={t('common.retry')} onPress={() => void products.fetchNextPage()} />
            </View>
          ) : undefined
        }
      />

      {sheet ? (
        <FilterSheet
          key={sheet}
          kind={sheet}
          initial={query}
          profileSize={profileSize}
          onClose={() => setSheet(null)}
          onApply={(next) => {
            setQuery({ ...next, q: query.q });
            setSheet(null);
          }}
        />
      ) : null}

      <BottomSheet visible={completeOpen} onClose={() => setCompleteOpen(false)} title={t('shop.completeTitle')}>
        <View className="gap-4">
          <Text variant="body" tone="muted">
            {t('shop.completeBody')}
          </Text>
          <SectionState
            query={wardrobe}
            inset={false}
            skeleton={
              <View className="flex-row gap-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-28 w-24 rounded-image" />
                ))}
              </View>
            }
          >
            {(pieces) =>
              pieces.length === 0 ? (
                <View className="items-start gap-2">
                  <Text variant="body" tone="muted">
                    {t('shop.completeEmpty')}
                  </Text>
                  <Button
                    variant="secondary"
                    label={t('shop.completeEmptyAction')}
                    onPress={() => {
                      setCompleteOpen(false);
                      router.push('/item/add');
                    }}
                  />
                </View>
              ) : (
                <View className="flex-row flex-wrap gap-3">
                  {pieces.map((piece) => (
                    <Pressable
                      key={piece.id}
                      onPress={() => {
                        setCompleteFor(piece);
                        setCompleteOpen(false);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={piece.name}
                      className="w-24 gap-1.5 active:opacity-80"
                    >
                      <ItemThumb category={piece.category} color={piece.color} uri={itemImage(piece)} className="aspect-[4/5] w-full rounded-image" />
                      <Text variant="caption" numberOfLines={2}>
                        {piece.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )
            }
          </SectionState>
        </View>
      </BottomSheet>
    </Screen>
  );
}
