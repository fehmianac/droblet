import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, View } from 'react-native';

import type { LibraryItem } from '@/api/contracts';
import { ITEM_CATEGORIES, type ItemCategory } from '@/api/contracts/wardrobe';
import { useItemLibrary } from '@/api/today';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Button } from '@/components/ui/Button';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { matchesSearch, toggleIn } from '@/features/wardrobe/filters';
import { libraryCategory, libraryItemFields } from '@/features/wardrobe/form';
import { useAddItems } from '@/features/wardrobe/mutations';
import { ItemGridSkeleton, ItemTile, padToColumns } from '@/features/wardrobe/parts';

/**
 * 12b Hazır kütüphane — add pieces without taking photos: pick the closest ready-made ones, edit
 * colour and size later. The add is a queued write, so it also works offline.
 */
export default function ItemLibraryScreen() {
  const { t } = useTranslation();
  const library = useItemLibrary();
  const addItems = useAddItems();
  const [selected, setSelected] = useState<string[]>([]);
  const [category, setCategory] = useState<ItemCategory | 'all'>('all');
  const [search, setSearch] = useState('');

  const submit = (items: LibraryItem[]) => {
    const chosen = items.filter((i) => selected.includes(i.id));
    if (chosen.length === 0) return;
    addItems.add(chosen.map((i) => ({ fields: libraryItemFields(i), draftId: null, libraryItemId: i.id, preview: i.imageUrl })));
    router.dismissTo('/wardrobe');
  };

  return (
    <Screen>
      <ScreenHeader title={t('itemLibrary.title')} leading="back" />
      <ScreenState
        query={library}
        skeleton={<ItemGridSkeleton rows={3} />}
        isEmpty={(items) => items.length === 0}
        empty={{ message: t('itemLibrary.empty'), actionLabel: t('itemLibrary.emptyAction'), onAction: () => router.replace('/item/add') }}
      >
        {(items) => {
          const categories = ITEM_CATEGORIES.filter((c) => items.some((i) => libraryCategory(i.category) === c));
          const visible = items.filter(
            (i) => (category === 'all' || libraryCategory(i.category) === category) && matchesSearch({ name: i.name, subcategory: null, fabric: null, brand: null }, search),
          );
          return (
            <>
              <FlatList
                data={padToColumns(visible)}
                keyExtractor={(item, index) => item?.id ?? `pad-${index}`}
                numColumns={3}
                columnWrapperClassName="gap-3 px-gutter"
                contentContainerClassName="gap-4 pb-8"
                keyboardShouldPersistTaps="handled"
                ListHeaderComponent={
                  <View className="gap-3 pb-1">
                    <View className="gap-3 px-gutter">
                      <Text variant="body" tone="muted">
                        {t('itemLibrary.body')}
                      </Text>
                      <TextField
                        label={t('itemLibrary.searchLabel')}
                        placeholder={t('itemLibrary.searchPlaceholder')}
                        value={search}
                        onChangeText={setSearch}
                        autoCorrect={false}
                        returnKeyType="search"
                        clearButtonMode="while-editing"
                      />
                    </View>
                    <ChipRow>
                      <Chip label={t('itemCategory.all')} selected={category === 'all'} onPress={() => setCategory('all')} />
                      {categories.map((c) => (
                        <Chip key={c} label={t(`itemCategory.${c}`)} selected={category === c} onPress={() => setCategory(c)} />
                      ))}
                    </ChipRow>
                  </View>
                }
                ListEmptyComponent={
                  <View className="items-center gap-4 px-gutter py-10" accessibilityLiveRegion="polite">
                    <Text variant="body" tone="muted" className="text-center">
                      {t('itemLibrary.noResults')}
                    </Text>
                    <Button
                      variant="secondary"
                      label={t('items.clearFilters')}
                      onPress={() => {
                        setSearch('');
                        setCategory('all');
                      }}
                    />
                  </View>
                }
                renderItem={({ item }: { item: LibraryItem | null }) =>
                  item ? (
                    <ItemTile
                      item={{
                        name: item.name,
                        category: libraryCategory(item.category),
                        color: 'other',
                        imageUrl: item.imageUrl,
                        originalImageUrl: null,
                        useOriginalImage: false,
                      }}
                      selected={selected.includes(item.id)}
                      onPress={() => setSelected((prev) => toggleIn(prev, item.id))}
                    />
                  ) : (
                    <View className="flex-1" />
                  )
                }
              />
              <BottomActionBar>
                <View className="flex-row flex-wrap items-center gap-x-4 gap-y-2">
                  <View className="min-w-28 flex-1 gap-0.5" accessibilityLiveRegion="polite">
                    <Text variant="bodyMedium">{t('itemLibrary.selected', { count: selected.length })}</Text>
                    <Text variant="caption" tone="muted">
                      {t('itemLibrary.editLater')}
                    </Text>
                  </View>
                  <Button className="grow" label={t('itemLibrary.add')} disabled={selected.length === 0} onPress={() => submit(items)} testID="library-add" />
                </View>
              </BottomActionBar>
            </>
          );
        }}
      </ScreenState>
    </Screen>
  );
}
