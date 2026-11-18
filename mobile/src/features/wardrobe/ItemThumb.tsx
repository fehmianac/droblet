import { Image } from 'expo-image';
import { Check } from 'lucide-react-native';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { ItemCategory, ItemColor } from '@/api/contracts/wardrobe';
import { Icon } from '@/components/ui/Icon';
import { garmentColors, placeholderTones, type PlaceholderTone } from '@/theme/tokens';
import { useThemeColors } from '@/theme/useThemeColors';

/** Line glyphs from the design boards (24 × 24, 1.1 stroke). */
const GLYPHS: Record<ItemCategory, string> = {
  top: 'M8 3 3 6l2 4 3-1v12h8V9l3 1 2-4-5-3c-.5 1.5-2 2.5-4 2.5S8.5 4.5 8 3z',
  bottom: 'M7 3h10l1 18h-4.2L12 10l-1.8 11H6z',
  dress: 'M9 2.5h6l-1 5.5 4.5 13h-13L10 8z',
  outerwear: 'M8 3 4 6v15h6V9l2 3 2-3v12h6V6l-4-3-2 4z',
  shoes: 'M3 16c0-2 .8-4.5 2-6.5l3 1c1 2 3 3 6 3l5 1c1.2.3 2 1.2 2 2.3V18H3z',
  bag: 'M5 9h14l-1.2 11H6.2zM9 9V7a3 3 0 0 1 6 0v2',
  accessory: 'M12 4a4 4 0 0 1 4 4c0 5-4 12-4 12S8 13 8 8a4 4 0 0 1 4-4zM9.5 8h5',
  beachwear: 'M8 3 3 6l2 4 3-1v12h8V9l3 1 2-4-5-3c-.5 1.5-2 2.5-4 2.5S8.5 4.5 8 3z',
  skiwear: 'M8 3 4 6v15h6V9l2 3 2-3v12h6V6l-4-3-2 4z',
};

/** Placeholder ground that hints at the garment's colour while there is no photo. */
const TONE_BY_COLOR: Record<ItemColor, PlaceholderTone | 'sand'> = {
  black: 'dark',
  navy: 'dark',
  brown: 'taupe',
  grey: 'oat',
  beige: 'camel',
  cream: 'sand',
  white: 'sand',
  blue: 'taupe',
  green: 'taupe',
  red: 'clay',
  pink: 'clay',
  other: 'oat',
};

/** The category's line glyph on its own (camera frame of board 12, placeholders). Decorative. */
export function GarmentGlyph({ category, size = 32, tone = 'ink', opacity = 0.5 }: { category: ItemCategory; size?: number; tone?: 'ink' | 'cream'; opacity?: number }) {
  const colors = useThemeColors();
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" opacity={opacity} accessible={false}>
      <Path d={GLYPHS[category]} fill="none" stroke={colors[tone]} strokeWidth={1.1} strokeLinejoin="round" />
    </Svg>
  );
}

type Props = {
  category: ItemCategory;
  color?: ItemColor;
  uri?: string | null;
  /** Size / aspect / radius, e.g. `aspect-[4/5] w-full rounded-image-lg` or `h-12 w-10 rounded-[8px]`. */
  className?: string;
  /** Glyph size in points (default 32; use ~20 for row thumbnails). */
  glyphSize?: number;
  accessibilityLabel?: string;
};

/**
 * A wardrobe piece's picture. Without a photo it renders the design's placeholder: a toned box with
 * the category's line glyph. Use this wherever an Item (or a look slot pointing at one) is shown.
 */
export function ItemThumb({ category, color = 'other', uri, className, glyphSize = 32, accessibilityLabel }: Props) {
  const colors = useThemeColors();
  const tone = TONE_BY_COLOR[color];
  const background = tone === 'sand' ? colors.sand : placeholderTones[tone];
  return (
    <View
      className={`items-center justify-center overflow-hidden ${className ?? ''}`}
      style={{ backgroundColor: background }}
      accessible={Boolean(accessibilityLabel)}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
    >
      {uri ? (
        <Image source={{ uri }} contentFit="cover" className="h-full w-full" transition={150} />
      ) : (
        <GarmentGlyph category={category} size={glyphSize} tone={tone === 'dark' ? 'cream' : 'ink'} />
      )}
    </View>
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
