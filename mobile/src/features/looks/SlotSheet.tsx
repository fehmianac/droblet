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
import { useLookSlotProducts } from '@/features/store/queries';
import { BrandMark } from '@/components/blocks/BrandMark';
import { SectionState } from '@/components/blocks/SectionState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatMoney } from '@/lib/format';

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
 * category fits the slot; Mağaza lists the catalogue pieces of the store slice
 * that fit the slot; they are added as missing pieces (`source: 'store'`).
 */
export function SlotSheet({ slot, current, items, onPick, onRemove, onClose }: Props) {
  const { t } = useTranslation();
  const [source, setSource] = useState<Source>('wardrobe');
  const products = useLookSlotProducts(slot && source === 'store' ? slot : null);
  if (!slot) return <BottomSheet visible={false} onClose={onClose}>{null}</BottomSheet>;

  const slotLabel = t(`lookSlot.${slot}`);
  const fitting = (items ?? []).filter((i) => SLOT_CATEGORIES[slot].includes(i.category));
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
              <SectionState
                query={products}
                inset={false}
                skeleton={<Skeleton className="h-16 rounded-image" />}
                isEmpty={(list) => list.length === 0}
                emptyText={t('lookEditor.storeEmpty', { slot: slotLabel })}
                errorText={t('lookEditor.storeError')}
              >
                {(list) => (
                  <View className="gap-1">
                    {list.map((product) => {
                      const selected = isCurrent('store', product.id);
                      const price = product.price ? formatMoney(product.price) : null;
                      const label = [product.brandName, product.name, price].filter(Boolean).join(', ');
                      return (
                        <Pressable
                          key={product.id}
                          onPress={() =>
                            onPick({
                              slot,
                              source: 'store',
                              refId: product.id,
                              name: product.name,
                              imageUrl: product.imageUrl,
                              brand: product.brandName,
                              price: product.price,
                              deleted: false,
                            })
                          }
                          accessibilityRole="button"
                          accessibilityLabel={selected ? t('lookEditor.selected', { name: label }) : label}
                          accessibilityState={{ selected }}
                          className="min-h-16 flex-row items-center gap-3 py-1.5 active:opacity-70"
                        >
                          <ItemThumb category={SLOT_FALLBACK_CATEGORY[slot]} uri={product.imageUrl} className="h-14 w-12 rounded-[8px]" glyphSize={22} />
                          <View className="flex-1 gap-0.5">
                            <BrandMark name={product.brandName} logoUrl={product.brandLogoUrl} />
                            <Text variant="body" numberOfLines={2}>
                              {product.name}
                            </Text>
                          </View>
                          {price ? <Text variant="bodyMedium">{price}</Text> : null}
                          {selected ? <Icon icon={Check} size={18} tone="accent" /> : null}
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </SectionState>
            </>
          )}
        </ScrollView>
        {current ? <Button variant="secondary" icon={Trash2} label={t('lookEditor.removeFromSlot')} onPress={onRemove} /> : null}
      </View>
    </BottomSheet>
  );
}
