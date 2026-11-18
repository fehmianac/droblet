import { router } from 'expo-router';
import { Check, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { SLOT_CATEGORIES, type LookSlot, type LookSlotKind } from '@/api/contracts/looks';
import type { Item } from '@/api/contracts/wardrobe';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Text } from '@/components/ui/Text';
import { ItemThumb } from '@/features/wardrobe/ItemThumb';
import { stubSlotProducts } from '@/fixtures/looks';
import { currentLanguage } from '@/i18n';
import { formatTry } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';

import { SLOT_FALLBACK_CATEGORY, slotFromWardrobeItem } from './logic';

type Source = 'wardrobe' | 'store';

type Props = {
  /** The slot being filled; null = closed. */
  slot: LookSlotKind | null;
  current: LookSlot | undefined;
  items: Item[] | undefined;
  onPick: (slot: LookSlot) => void;
  onRemove: () => void;
  onClose: () => void;
};

/**
 * Slot picker of the look builder ("Ayakkabı seç"): Gardırobum lists the wardrobe pieces whose
 * category fits the slot; Mağaza lists catalogue pieces (a small stand-in list until the store slice
 * provides the catalogue) which are added as missing pieces (`source: 'store'`).
 */
export function SlotSheet({ slot, current, items, onPick, onRemove, onClose }: Props) {
  const { t } = useTranslation();
  const [source, setSource] = useState<Source>('wardrobe');
  if (!slot) return <BottomSheet visible={false} onClose={onClose}>{null}</BottomSheet>;

  const slotLabel = t(`lookSlot.${slot}`);
  const fitting = (items ?? []).filter((i) => SLOT_CATEGORIES[slot].includes(i.category));
  const products = stubSlotProducts.filter((p) => p.slot === slot);
  const isCurrent = (src: Source, id: string) => current?.source === src && current.refId === id && !current.deleted;

  return (
    <BottomSheet visible onClose={onClose} title={t('lookEditor.sheetTitle', { slot: slotLabel })}>
      <View className="gap-3">
        <SegmentedControl<Source>
          value={source}
          onChange={setSource}
          accessibilityLabel={t('lookEditor.sheetTitle', { slot: slotLabel })}
          segments={[
            { value: 'wardrobe', label: t('lookEditor.tabWardrobe') },
            { value: 'store', label: t('lookEditor.tabStore') },
          ]}
        />
        <ScrollView style={{ maxHeight: 340 }} contentContainerClassName="gap-1 pb-1">
          {source === 'wardrobe' ? (
            fitting.length === 0 ? (
              <View className="items-center gap-3 py-6">
                <Text variant="body" tone="muted" className="text-center">
                  {t('lookEditor.sheetEmpty', { slot: slotLabel })}
                </Text>
                <Button
                  variant="secondary"
                  label={t('lookEditor.sheetEmptyAction')}
                  onPress={() => {
                    onClose();
                    router.push('/item/add');
                  }}
                />
              </View>
            ) : (
              fitting.map((item) => {
                const selected = isCurrent('wardrobe', item.id);
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => onPick(slotFromWardrobeItem(slot, item))}
                    accessibilityRole="button"
                    accessibilityLabel={selected ? t('lookEditor.selected', { name: item.name }) : item.name}
                    accessibilityState={{ selected }}
                    className="min-h-16 flex-row items-center gap-3 py-1.5 active:opacity-70"
                  >
                    <ItemThumb
                      category={item.category}
                      color={item.color}
                      uri={item.useOriginalImage ? item.originalImageUrl : item.imageUrl}
                      className="h-14 w-12 rounded-[8px]"
                      glyphSize={22}
                    />
                    <Text variant="body" numberOfLines={2} className="flex-1">
                      {item.name}
                    </Text>
                    {selected ? <Icon icon={Check} size={18} tone="accent" /> : null}
                  </Pressable>
                );
              })
            )
          ) : (
            <>
              <Text variant="caption" tone="muted" className="pb-1">
                {t('lookEditor.storeNote')}
              </Text>
              {products.map((product) => {
                const selected = isCurrent('store', product.id);
                const price = formatTry(product.price);
                return (
                  <Pressable
                    key={product.id}
                    onPress={() =>
                      onPick({ slot, source: 'store', refId: product.id, name: product.name, imageUrl: null, brand: product.brand, price: product.price, deleted: false })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={t(selected ? 'lookEditor.productLabelSelected' : 'lookEditor.productLabel', { brand: product.brand, name: product.name, price })}
                    accessibilityState={{ selected }}
                    className="min-h-16 flex-row items-center gap-3 py-1.5 active:opacity-70"
                  >
                    <ItemThumb category={SLOT_FALLBACK_CATEGORY[slot]} className="h-14 w-12 rounded-[8px]" glyphSize={22} />
                    <View className="flex-1 gap-0.5">
                      <Text variant="brand" tone="muted" numberOfLines={1}>
                        {toDisplayUpper(product.brand, currentLanguage())}
                      </Text>
                      <Text variant="body" numberOfLines={2}>
                        {product.name}
                      </Text>
                    </View>
                    <Text variant="bodyMedium">{price}</Text>
                    {selected ? <Icon icon={Check} size={18} tone="accent" /> : null}
                  </Pressable>
                );
              })}
            </>
          )}
        </ScrollView>
        {current ? <Button variant="secondary" icon={Trash2} label={t('lookEditor.removeFromSlot')} onPress={onRemove} /> : null}
      </View>
    </BottomSheet>
  );
}
