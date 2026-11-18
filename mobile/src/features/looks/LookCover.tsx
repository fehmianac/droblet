import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import type { LookSlot } from '@/api/contracts/looks';
import type { Item } from '@/api/contracts/wardrobe';
import { ItemThumb } from '@/features/wardrobe/ItemThumb';

import { SLOT_FALLBACK_CATEGORY } from './logic';

export type ItemsById = ReadonlyMap<string, Item>;

export function indexItems(items: Item[] | undefined): ItemsById {
  return new Map((items ?? []).map((i) => [i.id, i]));
}

type ThumbProps = { slot: LookSlot; itemsById: ItemsById; className?: string; glyphSize?: number };

/** Picture of one look slot: the wardrobe item's thumb, or a toned placeholder for store / deleted pieces. */
export function SlotThumb({ slot, itemsById, className, glyphSize }: ThumbProps) {
  const item = slot.source === 'wardrobe' ? itemsById.get(slot.refId) : undefined;
  return (
    <ItemThumb
      category={item?.category ?? SLOT_FALLBACK_CATEGORY[slot.slot]}
      color={item?.color ?? 'other'}
      uri={slot.imageUrl}
      className={className}
      glyphSize={glyphSize}
    />
  );
}

type Props = {
  tryOnImageUrl?: string | null;
  slots: LookSlot[];
  itemsById: ItemsById;
  /** Size / aspect / radius, e.g. `aspect-[4/5] w-full rounded-image-lg`. */
  className?: string;
  /** Overlays (tags, heart). */
  children?: ReactNode;
};

/**
 * Cover of a look: the owner's try-on image when there is one, otherwise a collage of its pieces
 * (1 = full, 2 = two columns, 3–4 = 2 × 2).
 */
export function LookCover({ tryOnImageUrl, slots, itemsById, className, children }: Props) {
  const shown = slots.slice(0, 4);
  const tile = shown.length <= 1 ? 'h-full w-full' : shown.length === 2 ? 'h-full w-1/2' : 'h-1/2 w-1/2';
  return (
    <View className={`overflow-hidden bg-sand ${className ?? ''}`}>
      {tryOnImageUrl ? (
        <Image source={{ uri: tryOnImageUrl }} contentFit="cover" className="h-full w-full" transition={150} />
      ) : (
        <View className="h-full w-full flex-row flex-wrap">
          {shown.map((slot) => (
            <SlotThumb key={slot.slot} slot={slot} itemsById={itemsById} className={tile} glyphSize={shown.length > 2 ? 28 : 36} />
          ))}
        </View>
      )}
      {children}
    </View>
  );
}
