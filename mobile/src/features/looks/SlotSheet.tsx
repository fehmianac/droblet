import { router } from 'expo-router';
import { Check, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { itemImageSource } from '@/api/imageSources';
import { SLOT_CATEGORIES, type LookSlot, type LookSlotKind } from '@/api/contracts/looks';
import type { Item } from '@/api/contracts/wardrobe';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Text } from '@/components/ui/Text';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { ItemThumb } from '@/features/wardrobe/ItemThumb';
import { useLookSlotProducts } from '@/features/store/queries';
import { SectionState } from '@/components/blocks/SectionState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatMoney } from '@/lib/format';

import { SLOT_FALLBACK_CATEGORY, slotFromWardrobeItem } from './logic';

type Source = 'wardrobe' | 'store';

type TileProps = {
  name: string;
  /** Second line (store price). */
  caption?: string | null;
  label: string;
  selected: boolean;
  onPress: () => void;
  children: ReactNode;
};

/** One cell of the three-column picker grid (15, sheet): 92-high picture, the name under it; a check marks the current piece. */
function Tile({ name, caption, label, selected, onPress, children, testID }: TileProps & { testID?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      testID={testID}
      className="w-1/3 gap-[5px] px-[5px] pb-2.5 active:opacity-70"
    >
      <View>
        {children}
        {selected ? (
          <View className="absolute right-1.5 top-1.5 h-5 w-5 items-center justify-center rounded-pill bg-ink">
            <Icon icon={Check} size={12} tone="cream" />
          </View>
        ) : null}
      </View>
      <Text variant="caption" numberOfLines={2}>
        {name}
      </Text>
      {caption ? (
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {caption}
        </Text>
      ) : null}
    </Pressable>
  );
}

type Props = {
  /** The slot being filled; null = closed. */
  slot: LookSlotKind | null;
  /** The piece being changed; undefined = a piece is being added to the box. */
  current: LookSlot | undefined;
  /** Every piece already in the look: the others are not offered again. */
  taken?: LookSlot[];
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
export function SlotSheet({ slot, current, taken = [], items, onPick, onRemove, onClose }: Props) {
  const { t } = useTranslation();
  const [source, setSource] = useState<Source>('wardrobe');
  const products = useLookSlotProducts(slot && source === 'store' ? slot : null);
  if (!slot) return <BottomSheet visible={false} onClose={onClose}>{null}</BottomSheet>;

  const slotLabel = t(`lookSlot.${slot}`);
  const isCurrent = (src: Source, id: string) => current?.source === src && current.refId === id && !current.deleted;
  // A piece already worn in this look (another layer, another box) is not offered a second time.
  const isTaken = (src: Source, id: string) => !isCurrent(src, id) && taken.some((p) => p.source === src && p.refId === id);
  const fitting = (items ?? []).filter((i) => SLOT_CATEGORIES[slot].includes(i.category) && !isTaken('wardrobe', i.id));

  return (
    <BottomSheet visible onClose={onClose} title={t('lookEditor.sheetTitle', { slot: slotLabel })}>
      <View className="gap-3.5">
        <SegmentedControl<Source>
          value={source}
          onChange={setSource}
          accessibilityLabel={t('lookEditor.sheetTitle', { slot: slotLabel })}
          segments={[
            { value: 'wardrobe', label: t('lookEditor.tabWardrobe') },
            { value: 'store', label: t('lookEditor.tabStore') },
          ]}
        />
        <ScrollView style={{ maxHeight: 340 }} contentContainerClassName="pb-1">
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
              <View className="-mx-[5px] flex-row flex-wrap">
                {fitting.map((item) => {
                  const selected = isCurrent('wardrobe', item.id);
                  return (
                    <Tile
                      key={item.id}
                      name={item.name}
                      label={selected ? t('lookEditor.selected', { name: item.name }) : item.name}
                      selected={selected}
                      testID={`look-slot-item-${item.id}`}
                      onPress={() => onPick(slotFromWardrobeItem(slot, item))}
                    >
                      <ItemThumb
                        category={item.category}
                        color={item.color}
                        {...itemImageSource(item, 'thumb')}
                        className="h-[92px] w-full rounded-field"
                        glyphSize={30}
                      />
                    </Tile>
                  );
                })}
              </View>
            )
          ) : (
            <>
              <Text variant="caption" tone="muted" className="pb-2">
                {t('lookEditor.storeNote')}
              </Text>
              <SectionState
                query={products}
                inset={false}
                skeleton={
                  <View className="flex-row gap-2.5">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-[92px] flex-1 rounded-field" />
                    ))}
                  </View>
                }
                isEmpty={(list) => list.length === 0}
                emptyText={t('lookEditor.storeEmpty', { slot: slotLabel })}
                errorText={t('lookEditor.storeError')}
              >
                {(list) => (
                  <View className="-mx-[5px] flex-row flex-wrap">
                    {list.filter((product) => !isTaken('store', product.id)).map((product) => {
                      const selected = isCurrent('store', product.id);
                      const price = product.price ? formatMoney(product.price) : null;
                      const label = [product.brandName, product.name, price].filter(Boolean).join(', ');
                      return (
                        <Tile
                          key={product.id}
                          name={product.name}
                          caption={[product.brandName, price].filter(Boolean).join(' · ')}
                          label={selected ? t('lookEditor.selected', { name: label }) : label}
                          selected={selected}
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
                        >
                          <ImageSlot
                            uri={product.imageUrl}
                            className="h-[92px] w-full rounded-field"
                            placeholder={{ kind: 'garment', category: product.category ?? SLOT_FALLBACK_CATEGORY[slot], color: product.colors[0], glyphSize: 30 }}
                          />
                        </Tile>
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
