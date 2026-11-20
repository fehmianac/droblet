import { router } from 'expo-router';
import { Search } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, TextInput, View } from 'react-native';

import type { LibraryItem } from '@/api/contracts';
import { ITEM_CATEGORIES, type ItemCategory } from '@/api/contracts/wardrobe';
import { useItemLibrary } from '@/api/today';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Button } from '@/components/ui/Button';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { asGarmentColor } from '@/components/ui/ImageSlot';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { matchesSearch, toggleIn } from '@/features/wardrobe/filters';
import { libraryCategory, libraryItemFields } from '@/features/wardrobe/form';
import { useAddItems } from '@/features/wardrobe/mutations';
import { ItemTile, padToColumns } from '@/features/wardrobe/parts';
import { useThemeColors } from '@/theme/useThemeColors';

/**
 * 12b Hazır kütüphane — add pieces without taking photos: pick the closest ready-made ones, edit
 * colour and size later. The add is a queued write, so it also works offline.
 */
export default function ItemLibraryScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const library = useItemLibrary();
  const addItems = useAddItems();
  const [selected, setSelected] = useState<string[]>([]);
  const [category, setCategory] = useState<ItemCategory | 'all'>('all');
  const [search, setSearch] = useState('');

  const submit = (items: LibraryItem[]) => {
    const chosen = items.filter((i) => selected.includes(i.id));
    if (chosen.length === 0) return;
    addItems.add(
      chosen.map((i) => ({ fields: libraryItemFields(i), draftId: null, libraryItemId: i.id, preview: i.imageUrl })),
      'library',
    );
    router.dismissTo('/wardrobe');
  };

  return (
    <Screen>
      <ScreenHeader title={t('itemLibrary.title')} leading="back" />
      <ScreenState
        query={library}
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
                columnWrapperClassName="gap-2.5 px-gutter"
                contentContainerClassName="gap-3 pb-8"
                keyboardShouldPersistTaps="handled"
                ListHeaderComponent={
                  <View className="gap-3 pb-1">
                    <View className="gap-3 px-gutter">
                      <Text variant="body" tone="muted">
                        {t('itemLibrary.body')}
                      </Text>
                      {/* Canvas: one 48 field with the magnifier inside and no visible label (the label is for screen readers). */}
                      <View className="h-field flex-row items-center gap-2.5 rounded-field border border-line bg-paper pl-3.5">
                        <Icon icon={Search} size={18} tone="muted" />
                        <TextInput
                          accessibilityLabel={t('itemLibrary.searchLabel')}
                          placeholder={t('itemLibrary.searchPlaceholder')}
                          placeholderTextColor={colors.muted}
                          selectionColor={colors.accent}
                          value={search}
                          onChangeText={setSearch}
                          autoCorrect={false}
                          returnKeyType="search"
                          clearButtonMode="while-editing"
                          maxFontSizeMultiplier={1.6}
                          className="h-full flex-1 pr-3.5 font-sans text-[15px] text-ink"
                          testID="library-search"
                        />
                      </View>
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
                        color: asGarmentColor(item.color),
                        imageUrl: item.imageUrl,
                        originalImageUrl: null,
                        useOriginalImage: false,
                      }}
                      selected={selected.includes(item.id)}
                      mark="add"
                      size="library"
                      onPress={() => setSelected((prev) => toggleIn(prev, item.id))}
                    />
                  ) : (
                    <View className="flex-1" />
                  )
                }
              />
              <BottomActionBar>
                {/* Canvas `.bar`: the count (15 medium) over the reassurance on the left, the 48 action on the right. */}
                <View className="flex-row items-center gap-2.5">
                  <View className="flex-1" accessibilityLiveRegion="polite">
                    <Text variant="bodyMedium" className="text-[15px]" numberOfLines={1}>
                      {t('itemLibrary.selected', { count: selected.length })}
                    </Text>
                    <Text variant="caption" tone="muted" numberOfLines={2}>
                      {t('itemLibrary.editLater')}
                    </Text>
                  </View>
                  <Button size="bar" label={t('itemLibrary.add')} disabled={selected.length === 0} onPress={() => submit(items)} testID="library-add" />
                </View>
              </BottomActionBar>
            </>
          );
        }}
      </ScreenState>
    </Screen>
  );
}
