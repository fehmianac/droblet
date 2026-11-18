import { router } from 'expo-router';
import { ListFilter, Plus, Search } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ITEM_CATEGORIES, type Item, type ItemSeason } from '@/api/contracts/wardrobe';
import { useHideTabBar } from '@/components/navigation/tabBarVisibility';
import { Badge } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { ScreenState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { FilterSheet } from '@/features/wardrobe/FilterSheet';
import { applyFilters, BRAND_OTHER, DEFAULT_FILTERS, isFiltering, sheetFilterCount, toggleIn, type ItemFilters } from '@/features/wardrobe/filters';
import { HangerGlyph } from '@/features/wardrobe/HangerGlyph';
import { useDeleteItems, useUpdateItem } from '@/features/wardrobe/mutations';
import { DeleteConfirmSheet, ItemTile, OutlineBadge, padToColumns, SeasonSheet } from '@/features/wardrobe/parts';
import { useItems } from '@/features/wardrobe/queries';
import { WardrobeHeader } from '@/features/wardrobe/WardrobeHeader';
import { formatDate } from '@/lib/format';
import { useIsOnline } from '@/sync/network';
import { useThemeColors } from '@/theme/useThemeColors';

type Sheet = 'none' | 'filter' | 'season' | 'delete';

/**
 * 10 Parçalar — the wardrobe grid: search, category chips + filter / sort sheet, the badges of what is
 * applied, and multi-select (the "Seç" chip or a long press) whose bar — "N parça seçildi" over Look oluştur ·
 * Sezon · Sil — takes the place of the bottom menu, as on the board. The list states are the shared
 * `ScreenState` drawn as on the `Durum*` boards (skeleton · empty · error · offline band over the cached
 * list). Filtering runs on the device.
 */
export default function WardrobeItemsScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const query = useItems();
  const update = useUpdateItem();
  const deletion = useDeleteItems();

  const [filters, setFilters] = useState<ItemFilters>(DEFAULT_FILTERS);
  const [searching, setSearching] = useState(false);
  const [selection, setSelection] = useState<string[] | null>(null);
  const [sheet, setSheet] = useState<Sheet>('none');

  const items = query.data;
  const hasItems = items !== undefined && items.length > 0;
  const selecting = selection !== null && hasItems;
  const selectedIds = selecting ? selection : [];
  const closeSheet = () => setSheet('none');
  // The selection bar sits where the bottom menu was (canvas: `showTabs: !selecting`).
  useHideTabBar(selecting);

  const toggleSearch = () => {
    if (searching) setFilters((f) => ({ ...f, search: '' }));
    setSearching(!searching);
  };
  const toggleSelecting = () => setSelection(selecting ? null : []);
  const clearFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setSearching(false);
  };

  // `DurumCevrimdisi`: the time of the cached list sits right of the count; "Bitti" stays reachable while selecting.
  const lastUpdated =
    !online && hasItems && !selecting && query.dataUpdatedAt > 0 ? (
      <Text variant="caption" tone="muted" className="pb-1.5">
        {t('items.lastUpdated', { time: formatDate(new Date(query.dataUpdatedAt), { hour: '2-digit', minute: '2-digit' }) })}
      </Text>
    ) : null;

  const header = (
    <WardrobeHeader
      current="items"
      eyebrow={t('items.eyebrow')}
      title={items ? t('items.count', { count: items.length }) : query.status === 'error' ? t('items.titleFallback') : undefined}
      titleLoading={query.status === 'pending' && online}
      actions={
        <>
          {hasItems ? <IconButton icon={Search} onPress={toggleSearch} accessibilityLabel={t('items.searchToggle')} testID="wardrobe.searchToggle" /> : null}
          <IconButton
            icon={Plus}
            variant="filled"
            onPress={() => router.push('/item/add')}
            disabled={!online}
            accessibilityLabel={t(online ? 'items.add' : 'items.addOffline')}
            testID="wardrobe-add"
          />
        </>
      }
      titleAccessory={
        lastUpdated ??
        (hasItems ? (
          <View className="pb-0.5">
            <Chip label={t(selecting ? 'items.done' : 'items.select')} onPress={toggleSelecting} />
          </View>
        ) : undefined)
      }
    >
      {searching && hasItems ? (
        <TextField
          label={t('items.searchLabel')}
          placeholder={t('items.searchPlaceholder')}
          value={filters.search}
          onChangeText={(search) => setFilters((f) => ({ ...f, search }))}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      ) : null}
    </WardrobeHeader>
  );

  const renderList = (list: Item[]) => {
    const visible = applyFilters(list, filters);
    const selectedItems = list.filter((i) => selectedIds.includes(i.id));
    const sheetCount = sheetFilterCount(filters);
    const toggleSelected = (id: string) => setSelection((prev) => toggleIn(prev ?? [], id));
    const none = selectedItems.length === 0;

    const listHeader = (
      <View className="gap-3 pb-3">
        <View className="flex-row items-center">
          <View className="flex-1">
            <ChipRow>
              <Chip label={t('itemCategory.all')} selected={filters.category === 'all'} onPress={() => setFilters({ ...filters, category: 'all' })} />
              {ITEM_CATEGORIES.map((c) => (
                <Chip key={c} label={t(`itemCategory.${c}`)} selected={filters.category === c} onPress={() => setFilters({ ...filters, category: c })} />
              ))}
            </ChipRow>
          </View>
          <View className="pr-gutter">
            <IconButton
              icon={ListFilter}
              iconSize={18}
              onPress={() => setSheet('filter')}
              badge={sheetCount}
              accessibilityLabel={sheetCount > 0 ? t('items.filterButtonActive', { count: sheetCount }) : t('items.filterButton')}
            />
          </View>
        </View>
        {/* What is applied: a narrowing filter is a filled badge, "all" is outlined; sort + the long-press hint on the right. */}
        <View className="flex-row flex-wrap items-center gap-1.5 px-gutter">
          {filters.seasons.length === 0 ? <OutlineBadge label={t('items.allSeasons')} /> : filters.seasons.map((s) => <Badge key={s} label={t(`itemSeason.${s}`)} />)}
          {filters.colors.length === 0 ? <OutlineBadge label={t('items.allColors')} /> : filters.colors.map((c) => <Badge key={c} label={t(`itemColor.${c}`)} />)}
          {filters.brands.map((b) => (
            <Badge key={b} label={b === BRAND_OTHER ? t('items.brandOther') : b} />
          ))}
          <Text variant="caption" tone="muted" className="ml-auto shrink text-right" numberOfLines={2}>
            {t('items.sortAndHint', { sort: t(`items.sort.${filters.sort}`) })}
          </Text>
        </View>
      </View>
    );

    return (
      <>
        <FlatList
          data={padToColumns(visible)}
          keyExtractor={(item, index) => item?.id ?? `pad-${index}`}
          numColumns={3}
          columnWrapperClassName="gap-2.5 px-gutter"
          contentContainerClassName="gap-3 pb-8"
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            <View className="items-center gap-4 px-gutter py-10" accessibilityLiveRegion="polite">
              <Text variant="body" tone="muted" className="text-center">
                {t('items.noResults')}
              </Text>
              {isFiltering(filters) || sheetCount > 0 ? <Button variant="secondary" label={t('items.clearFilters')} onPress={clearFilters} /> : null}
            </View>
          }
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.muted} />}
          renderItem={({ item }: { item: Item | null }) =>
            item ? (
              <ItemTile
                item={item}
                selected={selecting ? selectedIds.includes(item.id) : undefined}
                onPress={() => (selecting ? toggleSelected(item.id) : router.push({ pathname: '/item/[id]', params: { id: item.id } }))}
                onLongPress={selecting ? undefined : () => setSelection([item.id])}
              />
            ) : (
              <View className="flex-1" />
            )
          }
        />

        {selecting ? (
          // Canvas `.bar` in a column: paper, top hairline, 12 / 20 / 30; the count over the three actions (44 high).
          <View
            testID="selection-bar"
            className="gap-2 border-t border-line bg-paper px-gutter pt-3"
            style={{ paddingBottom: Math.max(insets.bottom, 16) }}
            accessibilityLiveRegion="polite"
          >
            <Text variant="label">{t('items.selected', { count: selectedItems.length })}</Text>
            <View className="flex-row gap-2">
              <Button
                className="flex-1"
                size="md"
                label={t('items.createLook')}
                disabled={none}
                onPress={() => {
                  const ids = selectedItems.map((i) => i.id).join(',');
                  setSelection(null);
                  router.push({ pathname: '/look/new', params: { itemIds: ids } });
                }}
              />
              {/* Canvas: the two outlined actions are 44 high with 14 side padding and 14 px text; "Sil" in the danger colour. */}
              <Pressable
                onPress={none ? undefined : () => setSheet('season')}
                disabled={none}
                accessibilityRole="button"
                accessibilityLabel={t('items.season')}
                accessibilityState={{ disabled: none }}
                className={`h-btn-secondary items-center justify-center rounded-pill border border-ink px-3.5 active:opacity-80 ${none ? 'opacity-40' : ''}`}
                testID="selection-season"
              >
                <Text variant="bodyMedium" numberOfLines={1}>
                  {t('items.season')}
                </Text>
              </Pressable>
              <Pressable
                onPress={none ? undefined : () => setSheet('delete')}
                disabled={none}
                accessibilityRole="button"
                accessibilityLabel={t('items.delete')}
                accessibilityState={{ disabled: none }}
                className={`h-btn-secondary items-center justify-center rounded-pill border border-danger px-3.5 active:opacity-80 ${none ? 'opacity-40' : ''}`}
                testID="selection-delete"
              >
                <Text variant="bodyMedium" tone="danger" numberOfLines={1}>
                  {t('items.delete')}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <FilterSheet
          visible={sheet === 'filter'}
          onClose={closeSheet}
          items={list}
          filters={filters}
          onApply={(next) => {
            setFilters(next);
            closeSheet();
          }}
        />
        <SeasonSheet
          visible={sheet === 'season'}
          onClose={closeSheet}
          initial={commonSeasons(selectedItems)}
          onSave={(seasons) => {
            update.setSeasons(selectedItems, seasons);
            closeSheet();
            setSelection(null);
          }}
        />
        <DeleteConfirmSheet
          visible={sheet === 'delete'}
          onClose={closeSheet}
          title={t('items.deleteTitle', { count: selectedItems.length })}
          body={t('items.deleteBody', { count: selectedItems.length })}
          confirmLabel={t('items.deleteConfirm')}
          onConfirm={() => {
            deletion.remove(selectedItems.map((i) => i.id));
            closeSheet();
            setSelection(null);
          }}
        />
      </>
    );
  };

  return (
    <>
      {header}
      <ScreenState
        query={query}
        loadingLabel={t('items.loading')}
        error={{ title: t('items.errorTitle'), message: t('items.errorBody') }}
        isEmpty={(list) => list.length === 0}
        empty={{
          icon: HangerGlyph,
          title: t('items.emptyTitle'),
          message: t('items.emptyBody'),
          actionLabel: t('items.emptyAction'),
          onAction: () => router.push('/item/add'),
          actionDisabled: !online,
          secondaryActionLabel: t('items.emptyLibrary'),
          onSecondaryAction: () => router.push('/item/library'),
        }}
      >
        {renderList}
      </ScreenState>
    </>
  );
}

/** Seasons every selected piece already has — the starting point of the bulk season sheet. */
function commonSeasons(items: Item[]): ItemSeason[] {
  const [first, ...rest] = items;
  if (!first) return [];
  return first.seasons.filter((s) => rest.every((i) => i.seasons.includes(s)));
}
