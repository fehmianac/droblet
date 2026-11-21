import type { ReactNode } from 'react';

import type { LookSlot } from '@/api/contracts/looks';
import type { Item } from '@/api/contracts/wardrobe';
import { itemImageSource, type ItemImageLike } from '@/api/imageSources';
import { ImageSlot, type Piece } from '@/components/ui/ImageSlot';
import { ItemThumb } from '@/features/wardrobe/ItemThumb';
import type { ImageSource } from '@/lib/images';

import { SLOT_FALLBACK_CATEGORY } from './logic';

export type ItemsById = ReadonlyMap<string, Item>;

export function indexItems(items: Item[] | undefined): ItemsById {
  return new Map((items ?? []).map((i) => [i.id, i]));
}

const NO_ITEMS: ItemsById = new Map();

/**
 * Where a slot's picture comes from: the wardrobe item as it is in the (fresher) items cache, else the URLs the look
 * was joined with (a store product, a piece missing from the cache).
 */
export function slotImageOf(slot: LookSlot, itemsById: ItemsById = NO_ITEMS): ItemImageLike {
  const item = slot.source === 'wardrobe' && !slot.deleted ? itemsById.get(slot.refId) : undefined;
  return item ?? slot;
}

type ThumbProps = { slot: LookSlot; itemsById: ItemsById; className?: string; glyphSize?: number; accessibilityLabel?: string };

/** Picture of one look slot: the wardrobe item's thumb, or the garment placeholder for store / deleted pieces. */
export function SlotThumb({ slot, itemsById, className, glyphSize, accessibilityLabel }: ThumbProps) {
  const item = slot.source === 'wardrobe' ? itemsById.get(slot.refId) : undefined;
  return (
    <ItemThumb
      category={item?.category ?? SLOT_FALLBACK_CATEGORY[slot.slot]}
      color={item?.color ?? 'other'}
      {...itemImageSource(slotImageOf(slot, itemsById), 'thumb')}
      className={className}
      glyphSize={glyphSize}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

/** A look's slots as collage pieces: each with its category, colour and photograph; store pieces are marked missing. */
export function lookPieces(slots: LookSlot[], itemsById: ItemsById = NO_ITEMS): Piece[] {
  return slots.map((slot) => {
    const item = slot.source === 'wardrobe' ? itemsById.get(slot.refId) : undefined;
    const image = itemImageSource(slotImageOf(slot, itemsById), 'thumb');
    return {
      category: item?.category ?? SLOT_FALLBACK_CATEGORY[slot.slot],
      color: item?.color ?? 'other',
      imageUrl: image.uri,
      ...(image.cacheKey ? { cacheKey: image.cacheKey } : {}),
      ...(image.onExpired ? { onExpired: image.onExpired } : {}),
      missing: slot.source === 'store',
    };
  });
}

/** Under this figure height a cover is a thumbnail (07 rows, 09 day sheet, 19 day strip). */
const SMALL_COVER = 80;

/**
 * What a cover without a rendered image draws. Full-size covers: the flat-lay of the pieces (21c: photographs, or
 * each piece's glyph on its colour, in body order). Thumbnails keep the grid collage (tilted pieces in free corners
 * would be specks at that size), and only of real photographs — glyph tiles would be unreadable at that size, so
 * they keep the canvas figure (empty list) and no "EKSİK" markers.
 */
export function coverPieces(slots: LookSlot[], itemsById: ItemsById = NO_ITEMS, figureHeight = 130): Piece[] {
  const pieces = lookPieces(slots, itemsById);
  if (figureHeight >= SMALL_COVER) return pieces;
  return pieces.some((p) => Boolean(p.imageUrl)) ? pieces.map((p) => ({ ...p, missing: false })) : [];
}

type Props = {
  /** Picks the placeholder ground (look id); omit for the neutral stage tone of the builder preview. */
  seed?: string;
  /** Height of the standing figure drawn while the look has no piece at all (130 on the 210-high lookbook card). */
  figureHeight?: number;
  tryOnImageUrl?: string | null;
  /** The cover with its cache key and refresh (`lookCoverSource(look)`, `tryOnImageSource(…)`); wins over `tryOnImageUrl`. */
  cover?: ImageSource | null;
  slots: LookSlot[];
  itemsById: ItemsById;
  /** Size / aspect / radius, e.g. `aspect-[4/5] w-full rounded-image-lg`. */
  className?: string;
  accessibilityLabel?: string;
  /** Overlays (tags, heart). */
  children?: ReactNode;
};

/**
 * Cover of a look, through `ImageSlot`: the owner's try-on image when there is one (skeleton, fade-in,
 * fallback on error); otherwise its pieces laid out flat in body order (21c; a thumbnail keeps the collage); and when the look has no piece at all (or the cover is a thumbnail without any photograph),
 * the standing figure on a ground picked by `seed`.
 */
export function LookCover({ seed, figureHeight = 130, tryOnImageUrl, cover, slots, itemsById, className, accessibilityLabel, children }: Props) {
  return (
    <ImageSlot
      {...(cover?.uri ? cover : { uri: tryOnImageUrl ?? null })}
      className={className}
      accessibilityLabel={accessibilityLabel}
      placeholder={{ kind: 'look', pieces: coverPieces(slots, itemsById, figureHeight), seed, figureHeight, layout: 'flatlay' }}
    >
      {children}
    </ImageSlot>
  );
}
