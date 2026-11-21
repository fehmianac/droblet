import { track } from '@/analytics/track';
import type { Item } from '@/api/contracts/wardrobe';
import { ItemThumb } from '@/features/wardrobe/ItemThumb';
import { useItems } from '@/features/wardrobe/queries';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronDown, LayoutGrid, Search, X } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';

import {
  CATALOG_COLORS,
  type CatalogColor,
  type ProductQuery,
  type ProductSummary,
} from '@/api/contracts/store';
import { itemImageSource } from '@/api/imageSources';
import { useBodyProfile } from '@/api/profile';
import { CartButton, SectionState } from '@/components/blocks/SectionState';
import { ListTabBar } from '@/components/navigation/TabBar';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateMessage } from '@/components/ui/StateMessage';
import { Text } from '@/components/ui/Text';
import { FilterSheet } from '@/features/store/FilterSheet';
import { filterCount, type FilterDimension } from '@/features/store/filters';
import { HangerGlyph } from '@/features/store/icons';
import { useSetFavorite } from '@/features/store/mutations';
import { ShopProductCard } from '@/features/store/ShopProductCard';
import {
  EMPTY_PRODUCT_QUERY,
  useCompleteSuggestions,
  useFavoriteProducts,
  useProducts,
} from '@/features/store/queries';
import { shopChipCategories } from '@/features/segment/catalog';
import { useSegment } from '@/features/segment/store';
import { useThemeColors } from '@/theme/useThemeColors';


/** Grid metrics of the board: 20 gutter, 12 between the two columns. */
const GUTTER = 20;
const COLUMN_GAP = 12;

function parseColors(param: string | undefined): CatalogColor[] {
  if (!param) return [];
  const known = CATALOG_COLORS as readonly string[];
  return param.split(',').filter((c): c is CatalogColor => known.includes(c));
}

/** Skeleton card of the board: a 120 block and two 9-high bars. */
function SkeletonCard({ short = false }: { short?: boolean }) {
  return (
    <View className="flex-1 gap-1.5">
      <Skeleton className="h-[120px] w-full rounded-image" />
      <Skeleton className={`h-[9px] rounded-pill ${short ? 'w-2/5' : 'w-1/2'}`} />
      <Skeleton className={`h-[9px] rounded-pill ${short ? 'w-[70%]' : 'w-4/5'}`} />
    </View>
  );
}

function GridSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <View className="gap-3.5 px-gutter">
      {Array.from({ length: rows }, (_, row) => (
        <View key={row} className="flex-row gap-3">
          <SkeletonCard />
          <SkeletonCard short />
        </View>
      ))}
    </View>
  );
}

/** The two entry cards under the search field: 20 glyph + a two-line 13-medium label, radius 16. */
function Shortcut({ glyph, label, onPress }: { glyph: ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label.replace('\n', ' ')}
      className="min-h-icon-btn flex-1 flex-row items-center gap-2.5 rounded-menu border border-line bg-paper p-3 active:opacity-80"
    >
      {glyph}
      <Text variant="price" numberOfLines={2} className="flex-1 leading-4">
        {label}
      </Text>
    </Pressable>
  );
}

type SearchProps = { value: string; onChangeText: (value: string) => void };

/** Search field of 21: 48 high, full pill, paper, an 18 muted magnifier 16 in; a clear button once filled. */
function ShopSearchField({ value, onChangeText }: SearchProps) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  return (
    <View className="h-field flex-row items-center rounded-pill border border-line bg-paper pl-4">
      <Icon icon={Search} size={18} tone="muted" />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={t('shop.searchLabel')}
        placeholder={t('shop.searchPlaceholder')}
        placeholderTextColor={colors.muted}
        selectionColor={colors.accent}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        maxFontSizeMultiplier={1.6}
        className="h-full flex-1 px-2 font-sans text-button text-ink"
      />
      {value !== '' ? (
        <Pressable
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          accessibilityLabel={t('shop.clearSearch')}
          className="h-icon-btn w-icon-btn items-center justify-center"
        >
          <Icon icon={X} size={18} tone="muted" />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * 21 Stil mağazası — search, the Kombin oluşturucu / Parçamı tamamla entries, category chips, the
 * Marka · Renk · Beden chips and the sort label (all four open the one "Filtrele" sheet) and a
 * 2-column infinite grid with skeleton cards. `?colors=a,b` preselects colour filters ("Paletime uygun
 * ürünler" from 30).
 */
export default function ShopScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { width, height } = useWindowDimensions();
  const cardWidth = (width - GUTTER * 2 - COLUMN_GAP) / 2;
  const params = useLocalSearchParams<{ colors?: string }>();
  const bodyProfile = useBodyProfile();
  // The category chips of the design, in order (canvas 17: the men's store has Jeanler instead of Elbiseler).
  // Shoes and bags are reached through search and the builder.
  const chipCategories = shopChipCategories(useSegment());
  const profileSize = bodyProfile.data?.size ?? null;

  const [query, setQuery] = useState<ProductQuery>(() => ({ ...EMPTY_PRODUCT_QUERY, colors: parseColors(params.colors) }));
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeFor, setCompleteFor] = useState<Item | null>(null);

  // Search as you type, but only ask the catalogue once typing pauses.
  useEffect(() => {
    const handle = setTimeout(() => {
      setQuery((q) => (q.q === search ? q : { ...q, q: search }));
      // Never the typed text: only that a search ran.
      if (search.trim()) track('search', { surface: 'shop' });
    }, 300);
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

  const filterChip = (dimension: FilterDimension, label: string) => {
    const count = filterCount(query, dimension);
    return (
      <Chip
        label={count > 0 ? t('shop.filterWithCount', { label, count }) : label}
        selected={count > 0}
        trailingIcon={ChevronDown}
        accessibilityHint={t('shop.filterHint')}
        onPress={() => setFilterOpen(true)}
      />
    );
  };

  const header = (
    <View className="gap-3 pt-1">
      <View className="gap-3 px-gutter">
        <ShopSearchField value={search} onChangeText={setSearch} />
        <View className="flex-row gap-2.5">
          <Shortcut glyph={<Icon icon={LayoutGrid} size={20} />} label={t('shop.builderShortcut')} onPress={() => router.push('/shop/builder')} />
          <Shortcut glyph={<HangerGlyph />} label={t('shop.completeShortcut')} onPress={() => setCompleteOpen(true)} />
        </View>
      </View>

      {completeFor ? (
        <View className="flex-row items-center gap-2 px-gutter">
          <View className="h-chip flex-1 flex-row items-center rounded-pill bg-ink px-[15px]">
            <Text variant="chip" tone="cream" numberOfLines={1}>
              {t('shop.completeFor', { name: completeFor.name })}
            </Text>
          </View>
          <Pressable
            onPress={() => setCompleteFor(null)}
            accessibilityRole="button"
            accessibilityLabel={t('shop.completeClear')}
            className="h-icon-btn w-icon-btn items-center justify-center rounded-pill border border-line"
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
            {chipCategories.map((c) => (
              <Chip
                key={c}
                label={t(`shop.category.${c}`)}
                selected={query.categories.length === 1 && query.categories[0] === c}
                onPress={() => setQuery((q) => ({ ...q, categories: [c] }))}
              />
            ))}
          </ChipRow>
          <View className="flex-row items-center gap-1.5 px-gutter">
            {filterChip('brand', t('shop.filterBrand'))}
            {filterChip('color', t('shop.filterColor'))}
            {filterChip('size', t('shop.filterSize'))}
            <View className="flex-1" />
            <Pressable
              onPress={() => setFilterOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t('shop.sortA11y', { sort: t(`shop.sort.${query.sort}`) })}
              hitSlop={8}
              className="min-h-chip justify-center active:opacity-70"
            >
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {t(`shop.sort.${query.sort}`)}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );

  return (
    <Screen>
      <ScreenHeader title={t('screens.shop')} leading="back" right={<CartButton />} />
      <FlatList
        data={items ?? []}
        keyExtractor={(item) => item.id}
        numColumns={2}
        ListHeaderComponent={header}
        contentContainerClassName="gap-3.5 pb-8"
        columnWrapperClassName="gap-3 px-gutter"
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
        renderItem={({ item, index }) => (
          <View style={{ width: cardWidth }}>
            <ShopProductCard
              testID={`shop.product.${index}`}
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
            skeleton={<GridSkeleton />}
          >
            {() => (
              <StateMessage
                message={t(filtered || completeFor ? 'shop.empty' : 'shop.emptyCatalog')}
                actionLabel={filtered || completeFor ? t('shop.emptyAction') : undefined}
                onAction={clearFilters}
              />
            )}
          </SectionState>
        }
        ListFooterComponent={
          products.isFetchingNextPage ? (
            <View accessible accessibilityLabel={t('a11y.loading')}>
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

      {filterOpen ? (
        <FilterSheet
          initial={query}
          profileSize={profileSize}
          onClose={() => setFilterOpen(false)}
          onApply={(next) => {
            setQuery({ ...next, q: query.q });
            setFilterOpen(false);
          }}
        />
      ) : null}

      <BottomSheet visible={completeOpen} onClose={() => setCompleteOpen(false)} title={t('shop.completeTitle')}>
        <View className="gap-3.5">
          <Text variant="caption" tone="muted">
            {t('shop.completeBody')}
          </Text>
          <SectionState
            query={wardrobe}
            inset={false}
            skeleton={
              <View className="flex-row gap-2.5">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-[92px] flex-1 rounded-image" />
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
                // Three columns, 10 apart, inside the sheet's 20 gutters; a large wardrobe scrolls.
                <ScrollView style={{ maxHeight: height * 0.5 }} contentContainerClassName="flex-row flex-wrap gap-2.5" showsVerticalScrollIndicator={false}>
                  {pieces.map((piece) => (
                    <Pressable
                      key={piece.id}
                      onPress={() => {
                        setCompleteFor(piece);
                        setCompleteOpen(false);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={piece.name}
                      style={{ width: (width - GUTTER * 2 - 20) / 3 }}
                      className="gap-[5px] active:opacity-80"
                    >
                      <ItemThumb category={piece.category} color={piece.color} {...itemImageSource(piece, 'thumb')} className="h-[92px] w-full rounded-image" />
                      <Text variant="caption" numberOfLines={2}>
                        {piece.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )
            }
          </SectionState>
        </View>
      </BottomSheet>
      <ListTabBar owner="discover" />
    </Screen>
  );
}
