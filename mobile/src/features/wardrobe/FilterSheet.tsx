import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { ITEM_COLORS, ITEM_SEASONS, type Item } from '@/api/contracts/wardrobe';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip, ChipWrap } from '@/components/ui/Chip';
import { Text } from '@/components/ui/Text';

import { applyFilters, BRAND_OTHER, brandOptions, toggleIn, type ItemFilters, type ItemSort } from './filters';
import { ColorSwatch } from './ItemThumb';

const SORTS: ItemSort[] = ['newest', 'mostWorn', 'leastWorn'];

type Props = {
  visible: boolean;
  onClose: () => void;
  items: Item[];
  filters: ItemFilters;
  onApply: (filters: ItemFilters) => void;
};

/** 10 › "Filtrele ve sırala": season, colour, brand, sort. Applies on the button, which shows the result count. */
export function FilterSheet({ visible, onClose, items, filters, onApply }: Props) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {visible ? <FilterSheetBody items={items} filters={filters} onApply={onApply} /> : null}
    </BottomSheet>
  );
}

function FilterSheetBody({ items, filters, onApply }: Pick<Props, 'items' | 'filters' | 'onApply'>) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ItemFilters>(filters);
  // Only colours that exist in the wardrobe are offered.
  const colors = ITEM_COLORS.filter((c) => items.some((i) => i.color === c));
  const brands = brandOptions(items);
  const count = applyFilters(items, draft).length;

  return (
    <View className="gap-4">
      <View className="flex-row items-center justify-between gap-3">
        <Text variant="h3" className="flex-1">
          {t('items.filterTitle')}
        </Text>
        <Button
          variant="text"
          label={t('items.clear')}
          onPress={() => setDraft({ ...draft, seasons: [], colors: [], brands: [], sort: 'newest' })}
        />
      </View>
      <ScrollView className="max-h-[420px]" contentContainerClassName="gap-4 pb-1" showsVerticalScrollIndicator={false}>
        <View className="gap-2">
          <Text variant="eyebrow">{t('items.seasonEyebrow')}</Text>
          <ChipWrap>
            {ITEM_SEASONS.map((s) => (
              <Chip
                key={s}
                label={t(`itemSeason.${s}`)}
                selected={draft.seasons.includes(s)}
                onPress={() => setDraft({ ...draft, seasons: toggleIn(draft.seasons, s) })}
              />
            ))}
          </ChipWrap>
        </View>

        {colors.length > 0 ? (
          <View className="gap-2">
            <Text variant="eyebrow">{t('items.colorEyebrow')}</Text>
            <View className="flex-row flex-wrap gap-x-1 gap-y-2">
              {colors.map((c) => {
                const selected = draft.colors.includes(c);
                return (
                  <Pressable
                    key={c}
                    onPress={() => setDraft({ ...draft, colors: toggleIn(draft.colors, c) })}
                    accessibilityRole="checkbox"
                    accessibilityLabel={t(`itemColor.${c}`)}
                    accessibilityState={{ checked: selected }}
                    className="min-h-icon-btn min-w-14 items-center gap-1 px-1"
                  >
                    <View className={`rounded-pill border-2 p-0.5 ${selected ? 'border-ink' : 'border-transparent'}`}>
                      <ColorSwatch color={c} />
                    </View>
                    <Text variant="caption" tone={selected ? 'ink' : 'muted'} numberOfLines={1}>
                      {t(`itemColor.${c}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {brands.length > 0 ? (
          <View className="gap-2">
            <Text variant="eyebrow">{t('items.brandEyebrow')}</Text>
            <ChipWrap>
              {brands.map((b) => (
                <Chip
                  key={b}
                  label={b === BRAND_OTHER ? t('items.brandOther') : b}
                  selected={draft.brands.includes(b)}
                  onPress={() => setDraft({ ...draft, brands: toggleIn(draft.brands, b) })}
                />
              ))}
            </ChipWrap>
          </View>
        ) : null}

        <View className="gap-2">
          <Text variant="eyebrow">{t('items.sortEyebrow')}</Text>
          <ChipWrap>
            {SORTS.map((s) => (
              <Chip key={s} label={t(`items.sort.${s}`)} selected={draft.sort === s} onPress={() => setDraft({ ...draft, sort: s })} />
            ))}
          </ChipWrap>
        </View>
      </ScrollView>
      <Button label={t('items.show', { count })} onPress={() => onApply(draft)} testID="filter-apply" />
    </View>
  );
}
