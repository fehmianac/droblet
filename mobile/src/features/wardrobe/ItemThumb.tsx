import { Check } from 'lucide-react-native';
import { View } from 'react-native';

import type { ItemCategory, ItemColor } from '@/api/contracts/wardrobe';
import { Icon } from '@/components/ui/Icon';
import { GarmentGlyph, ImageSlot } from '@/components/ui/ImageSlot';
import type { ImageRefresh } from '@/lib/images';
import { garmentColors } from '@/theme/tokens';

/** The category's line glyph on its own (camera frame of board 12, placeholders) — the shared one. */
export { GarmentGlyph };

type Props = {
  category: ItemCategory;
  /** Sub-type (id or name): its finer glyph when there is one (tie, watch, loafers…, canvas 17). */
  subcategory?: string | null;
  color?: ItemColor;
  uri?: string | null;
  /** expo-image cache key (`itemImageSource(item, 'thumb')` gives uri + cacheKey + onExpired: spread it). */
  cacheKey?: string | null;
  /** Refresh of an expired presigned URL (see `ImageSlot`). */
  onExpired?: ImageRefresh;
  /** Size / aspect / radius, e.g. `aspect-[4/5] w-full rounded-image-lg` or `h-12 w-10 rounded-[8px]`. */
  className?: string;
  /** Glyph size in points (default 32; use ~20 for row thumbnails). */
  glyphSize?: number;
  accessibilityLabel?: string;
};

/**
 * A wardrobe piece's picture — `ImageSlot` with the garment placeholder: without a photo (or when it
 * fails to load) a ground tinted from the colour with the category's line glyph. Use this wherever an
 * Item (or a look slot pointing at one) is shown.
 */
export function ItemThumb({ category, subcategory, color = 'other', uri, cacheKey, onExpired, className, glyphSize = 32, accessibilityLabel }: Props) {
  return (
    <ImageSlot
      uri={uri}
      cacheKey={cacheKey}
      onExpired={onExpired}
      className={className}
      accessibilityLabel={accessibilityLabel}
      placeholder={{ kind: 'garment', category, subcategory, color, glyphSize }}
    />
  );
}

/** Colours light enough that the check on a chosen swatch has to be ink. */
const LIGHT_SWATCHES: readonly ItemColor[] = ['white', 'cream', 'beige', 'pink', 'other'];

/**
 * Round colour dot for the filter sheet and colour pickers. Always paired with a text label / a11y label.
 * `selected` (optional) adds an ink ring and a check.
 */
export function ColorSwatch({ color, size = 28, selected }: { color: ItemColor; size?: number; selected?: boolean }) {
  return (
    <View
      className={`items-center justify-center rounded-pill ${selected ? 'border-2 border-ink' : 'border border-line'}`}
      style={{ width: size, height: size, backgroundColor: garmentColors[color] }}
      accessible={false}
    >
      {selected ? <Icon icon={Check} size={Math.round(size * 0.4)} tone={LIGHT_SWATCHES.includes(color) ? 'ink' : 'cream'} /> : null}
    </View>
  );
}
