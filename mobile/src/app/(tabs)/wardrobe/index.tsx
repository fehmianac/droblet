import { router } from 'expo-router';
import { CloudOff, Plus, RefreshCw, Search, Shirt, SlidersHorizontal } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, View } from 'react-native';

import { ITEM_CATEGORIES, type Item, type ItemSeason } from '@/api/contracts/wardrobe';
import { extractApiError } from '@/api/errors';
import { Badge } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { FilterSheet } from '@/features/wardrobe/FilterSheet';
import { applyFilters, BRAND_OTHER, DEFAULT_FILTERS, isFiltering, sheetFilterCount, toggleIn, type ItemFilters } from '@/features/wardrobe/filters';
import { useDeleteItems, useUpdateItem } from '@/features/wardrobe/mutations';
import { DeleteConfirmSheet, ItemGridSkeleton, ItemTile, padToColumns, SeasonSheet, StatePanel } from '@/features/wardrobe/parts';
import { useItems } from '@/features/wardrobe/queries';
import { WardrobeHeader } from '@/features/wardrobe/WardrobeHeader';
import { formatDate } from '@/lib/format';
import { useIsOnline } from '@/sync/network';
import { useThemeColors } from '@/theme/useThemeColors';

type Sheet = 'none' | 'filter' | 'season' | 'delete';

/**
 * 10 Parçalar — the wardrobe grid: category chips, filter / sort sheet, search, long-press
 * multi-select (look, season, delete), and the four list states of the `Durum*` boards
 * (skeleton · empty · error · offline with the cached list). Filtering runs on the device.
 */
export default function WardrobeItemsScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const online = useIsOnline();
  const query = useItems();
  const update = useUpdateItem();
  const deletion = useDeleteItems();

  const [filters, setFilters] = useState<ItemFilters>(DEFAULT_FILTERS);
  const [searching, setSearching] = useState(false);
  const [selection, setSelection] = useState<string[] | null>(null);
  const [sheet, setSheet] = useState<Sheet>('none');

  const items = query.data;
  const selecting = selection !== null;
  const closeSheet = () => setSheet('none');

  const toggleSearch = () => {
    if (searching) setFilters((f) => ({ ...f, search: '' }));
    setSearching(!searching);
  };
  const toggleSelecting = () => setSelection(selecting ? null : []);
  const clearFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setSearching(false);
  };

  const header = (
    <WardrobeHeader
      current="items"
      eyebrow={t('items.eyebrow')}
      title={items ? t('items.count', { count: items.length }) : query.status === 'error' ? t('items.titleFallback') : undefined}
      actions={
        <>
          {items && items.length > 0 ? (
            <IconButton icon={Search} active={false} onPress={toggleSearch} accessibilityLabel={t('items.searchToggle')} testID="wardrobe.searchToggle" />
          ) : null}
          <IconButton
            icon={Plus}
            onPress={() => router.push('/item/add')}
            disabled={!online}
            accessibilityLabel={t(online ? 'items.add' : 'items.addOffline')}
          />
        </>
      }
      titleAccessory={
        items && items.length > 0 ? <Chip label={t(selecting ? 'items.done' : 'items.select')} selected={selecting} onPress={toggleSelecting} /> : undefined
      }
    >
      {searching ? (
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

  let body;
  if (items === undefined) {
    if (query.status === 'error') {
      body = (
        <StatePanel icon={RefreshCw} title={t('items.errorTitle')} body={t(extractApiError(query.error) === 'unknown' ? 'items.errorBody' : `errors.${extractApiError(query.error)}`)}>
          <Button label={t('common.retry')} icon={RefreshCw} onPress={() => void query.refetch()} loading={query.isRefetching} />
        </StatePanel>
      );
    } else if (!online || query.fetchStatus === 'paused') {
      body = (
        <StatePanel icon={CloudOff} title={t('items.offlineTitle')} body={t('states.offlineNoCache')}>
          <Button variant="secondary" label={t('common.retry')} onPress={() => void query.refetch()} />
        </StatePanel>
      );
    } else {
      body = (
        <View accessible accessibilityLabel={t('items.loading')} accessibilityState={{ busy: true }}>
          <ItemGridSkeleton />
        </View>
      );
    }
  } else if (items.length === 0) {
    body = (
      <StatePanel icon={Shirt} title={t('items.emptyTitle')} body={t('items.emptyBody')}>
        <Button label={t('items.emptyAction')} onPress={() => router.push('/item/add')} disabled={!online} testID="wardrobe.addItem" />
        <Button variant="secondary" label={t('items.emptyLibrary')} onPress={() => router.push('/item/library')} testID="wardrobe.openLibrary" />
      </StatePanel>
    );
  } else {
    const visible = applyFilters(items, filters);
    const selectedItems = items.filter((i) => selection?.includes(i.id));
    const sheetCount = sheetFilterCount(filters);
    const toggleSelected = (id: string) => setSelection((prev) => toggleIn(prev ?? [], id));

    const listHeader = (
      <View className="gap-2 pb-3">
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
              icon={SlidersHorizontal}
              onPress={() => setSheet('filter')}
              badge={sheetCount}
              accessibilityLabel={sheetCount > 0 ? t('items.filterButtonActive', { count: sheetCount }) : t('items.filterButton')}
            />
          </View>
        </View>
        <View className="flex-row flex-wrap items-center gap-2 px-gutter">
          {filters.seasons.length === 0 ? <Badge label={t('items.allSeasons')} /> : filters.seasons.map((s) => <Badge key={s} label={t(`itemSeason.${s}`)} />)}
          {filters.colors.length === 0 ? <Badge label={t('items.allColors')} /> : filters.colors.map((c) => <Badge key={c} label={t(`itemColor.${c}`)} />)}
          {filters.brands.map((b) => (
            <Badge key={b} label={b === BRAND_OTHER ? t('items.brandOther') : b} />
          ))}
          <Text variant="caption" tone="muted" className="flex-1" numberOfLines={2}>
            {t('items.sortAndHint', { sort: t(`items.sort.${filters.sort}`) })}
          </Text>
        </View>
        {!online && query.dataUpdatedAt > 0 ? (
          <Text variant="caption" tone="muted" className="px-gutter">
            {t('items.lastUpdated', { time: formatDate(new Date(query.dataUpdatedAt), { hour: '2-digit', minute: '2-digit' }) })}
          </Text>
        ) : null}
      </View>
    );

    body = (
      <>
        <FlatList
          data={padToColumns(visible)}
          keyExtractor={(item, index) => item?.id ?? `pad-${index}`}
          numColumns={3}
          columnWrapperClassName="gap-3 px-gutter"
          contentContainerClassName="gap-4 pb-8"
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
                selected={selecting ? selection.includes(item.id) : undefined}
                onPress={() => (selecting ? toggleSelected(item.id) : router.push({ pathname: '/item/[id]', params: { id: item.id } }))}
                onLongPress={selecting ? undefined : () => setSelection([item.id])}
              />
            ) : (
              <View className="flex-1" />
            )
          }
        />

        {selecting ? (
          <View className="gap-2 border-t border-line bg-paper px-gutter py-3" accessibilityLiveRegion="polite">
            <Text variant="caption" tone="muted">
              {t('items.selected', { count: selection.length })}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              <Button
                className="grow"
                label={t('items.createLook')}
                disabled={selection.length === 0}
                onPress={() => {
                  const ids = selection.join(',');
                  setSelection(null);
                  router.push({ pathname: '/look/new', params: { itemIds: ids } });
                }}
              />
              <Button variant="secondary" className="h-btn-primary grow" label={t('items.season')} disabled={selection.length === 0} onPress={() => setSheet('season')} />
              <Button variant="secondary" className="h-btn-primary grow" label={t('items.delete')} disabled={selection.length === 0} onPress={() => setSheet('delete')} />
            </View>
          </View>
        ) : null}

        <FilterSheet
          visible={sheet === 'filter'}
          onClose={closeSheet}
          items={items}
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
  }

  return (
    <>
      <OfflineBanner />
      {header}
      {body}
    </>
  );
}

/** Seasons every selected piece already has — the starting point of the bulk season sheet. */
function commonSeasons(items: Item[]): ItemSeason[] {
  const [first, ...rest] = items;
  if (!first) return [];
  return first.seasons.filter((s) => rest.every((i) => i.seasons.includes(s)));
}
