import { Image } from 'expo-image';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Text as RNText, View, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { ItemCategory, ItemColor } from '@/api/contracts/wardrobe';
import { toSubcategoryId } from '@/api/wire/subcategories';
import type { ImageRefresh } from '@/lib/images';
import { placeholderTones, type PlaceholderTone } from '@/theme/tokens';
import { useThemeColors } from '@/theme/useThemeColors';

import { MissingTag } from './Bits';
import { Silhouette } from './Silhouette';
import { Skeleton } from './Skeleton';

/**
 * ONE place for "an image may be missing". Nothing in the app renders an empty box:
 *
 * - garment / product without a picture → the category's line glyph on a ground tinted from its colour;
 * - look / outfit without a rendered image → a collage of its pieces (canvas "Parça kolajı", 17b), or on a look
 *   cover the pieces laid out flat in body order (canvas 21c, `layout: 'flatlay'`);
 * - person without a photo → initials;
 * - anything else → the standing figure of the canvas look placeholders.
 *
 * With a URL the picture loads through expo-image: sand skeleton while loading, fade-in, and the same
 * placeholder if loading fails.
 */

/** Line glyphs from the design boards (24 × 24, 1.1 stroke). */
export const GARMENT_GLYPHS: Record<ItemCategory, string> = {
  top: 'M8 3 3 6l2 4 3-1v12h8V9l3 1 2-4-5-3c-.5 1.5-2 2.5-4 2.5S8.5 4.5 8 3z',
  bottom: 'M7 3h10l1 18h-4.2L12 10l-1.8 11H6z',
  dress: 'M9 2.5h6l-1 5.5 4.5 13h-13L10 8z',
  outerwear: 'M8 3 4 6v15h6V9l2 3 2-3v12h6V6l-4-3-2 4z',
  shoes: 'M3 16c0-2 .8-4.5 2-6.5l3 1c1 2 3 3 6 3l5 1c1.2.3 2 1.2 2 2.3V18H3z',
  bag: 'M5 9h14l-1.2 11H6.2zM9 9V7a3 3 0 0 1 6 0v2',
  accessory: 'M12 4a4 4 0 0 1 4 4c0 5-4 12-4 12S8 13 8 8a4 4 0 0 1 4-4zM9.5 8h5',
  beachwear: 'M8 3 3 6l2 4 3-1v12h8V9l3 1 2-4-5-3c-.5 1.5-2 2.5-4 2.5S8.5 4.5 8 3z',
  skiwear: 'M8 3 4 6v15h6V9l2 3 2-3v12h6V6l-4-3-2 4z',
  socks: 'M9 3h6v9l-4.5 5.5a3 3 0 0 1-4.6-3.8L9 10zM9 6h6',
};

/**
 * Finer glyphs (canvas 17 "Yeni parça glifleri") for sub-types and catalogue categories the family glyph does not
 * tell apart — mostly the men's set. Keyed by `SubcategoryCatalog` id; catalogue spellings are aliased below.
 */
export const FINE_GLYPHS: Record<string, string> = {
  'suit-jacket': 'M8 3 4 6v15h16V6l-4-3M8 3l4 4 4-4M8 3l1.5 6L12 21l2.5-12L16 3M7 14h2.5',
  chinos: 'M7 3h10l1 18h-4.2L12 10l-1.8 11H6zM7.2 6.5c1.5 0 2.5-1.4 2.6-3.5M16.8 6.5c-1.5 0-2.5-1.4-2.6-3.5',
  tie: 'M10 3h4l-1 3.2 2.4 10.3L12 21l-3.4-4.5L11 6.2zM11 6.2h2',
  loafers: 'M3 16c0-2 .8-4.5 2-6.5l3 1c1 2 3 3 6 3l5 1c1.2.3 2 1.2 2 2.3V18H3zM8.5 11.4c1.6 1.4 3.4 2 5.5 2.1',
  watch: 'M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0zM12 9.5V12l1.7 1.1M9.6 7.6 10.2 3h3.6l.6 4.6M9.6 16.4l.6 4.6h3.6l.6-4.6',
  polo: 'M8 3 3 6l2 4 3-1v12h8V9l3 1 2-4-5-3c-.5 1.5-2 2.5-4 2.5S8.5 4.5 8 3zM12 5.5V10M10.6 4.7 12 5.5l1.4-.8',
  cap: 'M4 15.5c0-4.7 3.6-8.5 8-8.5s8 3.8 8 8.5zM12 7v1.6M20 15.5h2.5',
  belt: 'M3 10h18v4H3zM14 9v6h4V9zM16 12h-3',
};
/** Other spellings (catalogue categories, near sub-types) of the fine glyphs. */
const FINE_ALIAS: Record<string, string> = {
  suit: 'suit-jacket',
  waistcoat: 'suit-jacket',
  oxfords: 'loafers',
  'oxford-shoes': 'loafers',
  derbies: 'loafers',
  'boat-shoes': 'loafers',
  'suit-trousers': 'chinos',
  'polo-shirt': 'polo',
  necktie: 'tie',
  watches: 'watch',
  ties: 'tie',
  belts: 'belt',
};

/** The glyph path of a piece: its sub-type's fine glyph when there is one, else its category family's. */
export function garmentGlyphPath(category: string | null | undefined, subcategory?: string | null): string {
  for (const key of [subcategory ? toSubcategoryId(subcategory) : null, category]) {
    if (!key) continue;
    const fine = FINE_GLYPHS[FINE_ALIAS[key] ?? key];
    if (fine) return fine;
  }
  return GARMENT_GLYPHS[asGarmentCategory(category)];
}

export type SlotTone = PlaceholderTone | 'sand';

/** Placeholder ground that hints at the garment's colour while there is no photo. */
export const TONE_BY_COLOR: Record<ItemColor, SlotTone> = {
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

const SEED_TONES: readonly SlotTone[] = ['stage', 'clay', 'oat', 'taupe', 'camel', 'dark'];

/** Stable tone for things that have no colour of their own (looks, edits, posts): same id → same ground. */
export function toneFromSeed(seed: string | undefined): SlotTone {
  if (!seed) return 'stage';
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return SEED_TONES[hash % SEED_TONES.length] ?? 'stage';
}

const CATEGORY_SET = new Set<string>(Object.keys(GARMENT_GLYPHS));
const COLOR_SET = new Set<string>(Object.keys(TONE_BY_COLOR));

/** Catalogue (store / wire) categories that are finer than the wardrobe's: each draws its family's glyph. */
const CATEGORY_ALIAS: Record<string, ItemCategory> = {
  tshirt: 'top',
  shirt: 'top',
  blouse: 'top',
  knit: 'top',
  knitwear: 'top',
  sweatshirt: 'top',
  activewear: 'top',
  jacket: 'outerwear',
  coat: 'outerwear',
  trousers: 'bottom',
  jeans: 'bottom',
  skirt: 'bottom',
  shorts: 'bottom',
  swimwear: 'beachwear',
  onePiece: 'dress',
};
/** Catalogue colours outside the wardrobe's twelve. */
const COLOR_ALIAS: Record<string, ItemColor> = { olive: 'green', burgundy: 'red', camel: 'beige', gray: 'grey' };

/** Narrows free-form catalogue values (store products, library items) to the glyph / tint vocabulary. */
export function asGarmentCategory(value: string | null | undefined): ItemCategory {
  if (!value) return 'top';
  return CATEGORY_SET.has(value) ? (value as ItemCategory) : (CATEGORY_ALIAS[value] ?? 'top');
}
export function asGarmentColor(value: string | null | undefined): ItemColor {
  if (!value) return 'other';
  return COLOR_SET.has(value) ? (value as ItemColor) : (COLOR_ALIAS[value] ?? 'other');
}

/** Up to two initials of a display name or handle ("Selin Y." → "SY", "@ornek_stilist" → "O"). */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '')
    .replace(/^@/, '')
    .split(/[\s._-]+/)
    .filter((w) => /\p{L}/u.test(w));
  const letters = words.slice(0, 2).map((w) => [...w][0] ?? '');
  return letters.join('').toLocaleUpperCase('tr-TR');
}

export type Piece = {
  category?: string | null;
  color?: string | null;
  imageUrl?: string | null;
  /** expo-image cache key of `imageUrl` (`pickImage` / `itemImageSource`). */
  cacheKey?: string | null;
  /** Refresh of an expired `imageUrl` (see `ImageSlot.onExpired`). */
  onExpired?: ImageRefresh;
  /** A piece the user does not own: dashed espresso frame + "EKSİK" marker, as on 17b. */
  missing?: boolean;
};

/** Glyph size in points, or a percentage of its box ('56%'): the glyph keeps its aspect inside. */
export type GlyphSize = number | `${number}%`;

export type SlotPlaceholder =
  | { kind: 'garment'; category?: string | null; subcategory?: string | null; color?: string | null; glyphSize?: GlyphSize }
  /** `flatlay`: the pieces laid out flat in body order (look covers, 21c); thumbnails (figure under 80) keep the collage. */
  | { kind: 'look'; pieces: Piece[]; seed?: string; figureHeight?: number; layout?: 'collage' | 'flatlay' }
  | { kind: 'avatar'; name: string | null | undefined }
  | { kind: 'figure'; seed?: string; tone?: SlotTone; figureHeight?: number };

function useGround(tone: SlotTone): { backgroundColor: string; ink: 'ink' | 'cream' } {
  const colors = useThemeColors();
  return { backgroundColor: tone === 'sand' ? colors.sand : placeholderTones[tone], ink: tone === 'dark' ? 'cream' : 'ink' };
}

/** The category's line glyph on its own. Decorative. */
export function GarmentGlyph({
  category,
  subcategory,
  size = 32,
  tone = 'ink',
  opacity = 0.5,
}: {
  category: ItemCategory | string;
  subcategory?: string | null;
  size?: GlyphSize;
  tone?: 'ink' | 'cream';
  opacity?: number;
}) {
  const colors = useThemeColors();
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" opacity={opacity} accessible={false}>
      <Path d={garmentGlyphPath(category, subcategory)} fill="none" stroke={colors[tone]} strokeWidth={1.1} strokeLinejoin="round" />
    </Svg>
  );
}

function GarmentPlaceholder({
  category,
  subcategory,
  color,
  glyphSize,
}: {
  category?: string | null;
  subcategory?: string | null;
  color?: string | null;
  glyphSize?: GlyphSize;
}) {
  const ground = useGround(TONE_BY_COLOR[asGarmentColor(color)]);
  return (
    <View className="h-full w-full items-center justify-center" style={{ backgroundColor: ground.backgroundColor }} testID="image-slot-garment">
      <GarmentGlyph category={category ?? 'top'} subcategory={subcategory} size={glyphSize} tone={ground.ink} />
    </View>
  );
}

function FigurePlaceholder({ tone, figureHeight }: { tone: SlotTone; figureHeight?: number }) {
  const ground = useGround(tone);
  const [height, setHeight] = useState(0);
  return (
    <View
      className="h-full w-full items-center justify-center"
      style={{ backgroundColor: ground.backgroundColor }}
      onLayout={figureHeight ? undefined : (e) => setHeight(e.nativeEvent.layout.height)}
      testID="image-slot-figure"
    >
      {figureHeight || height > 0 ? <Silhouette height={figureHeight ?? Math.round(height * 0.62)} tone={ground.ink} /> : null}
    </View>
  );
}

function CollageTile({ piece, glyphSize }: { piece: Piece; glyphSize: number }) {
  return (
    <View className={`flex-1 overflow-hidden rounded-image ${piece.missing ? 'border-[1.5px] border-dashed border-accent' : ''}`}>
      <ImageSlot
        uri={piece.imageUrl}
        cacheKey={piece.cacheKey}
        onExpired={piece.onExpired}
        className="h-full w-full"
        placeholder={{ kind: 'garment', category: piece.category, color: piece.color, glyphSize }}
      />
      {piece.missing ? <MissingTag short className="absolute right-1 top-1" /> : null}
    </View>
  );
}

/**
 * Collage of a look's pieces (canvas "Parça kolajı"): 1 = full, 2 = two columns, 3–4 = 2 × 2 with a taller
 * first row (150 : 110 on the board), 4 pt… 8 pt gaps on paper.
 */
export function PieceCollage({ pieces, compact = false }: { pieces: Piece[]; compact?: boolean }) {
  const shown = pieces.slice(0, 4);
  const gap = compact ? 'gap-1' : 'gap-2';
  const glyph = compact ? 22 : 40;
  if (shown.length <= 2) {
    return (
      <View className={`h-full w-full flex-row bg-paper ${gap} ${compact ? 'p-1' : 'p-2'}`} testID="image-slot-collage">
        {shown.map((piece, i) => (
          <CollageTile key={i} piece={piece} glyphSize={glyph} />
        ))}
      </View>
    );
  }
  const rows = [shown.slice(0, 2), shown.slice(2)];
  return (
    <View className={`h-full w-full bg-paper ${gap} ${compact ? 'p-1' : 'p-2'}`} testID="image-slot-collage">
      {rows.map((row, r) => (
        <View key={r} className={`flex-row ${gap}`} style={{ flex: r === 0 ? 15 : 11 }}>
          {row.map((piece, i) => (
            <CollageTile key={i} piece={piece} glyphSize={glyph} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** A frame on the cover as fractions of its width / height, and a tilt in degrees. */
export type FlatlayFrame = { x: number; y: number; w: number; h: number; rotate: number };
export type FlatlayBucket = 'upper' | 'lower' | 'dress' | 'shoes' | 'accessory';
export type FlatlaySpot = { index: number; bucket: FlatlayBucket; frame: FlatlayFrame; small: boolean };

/** Where a piece lies in the flat-lay: by its body zone (beachwear / skiwear lie as tops, a bag as an accessory). */
export function flatlayBucket(category: string | null | undefined): FlatlayBucket {
  switch (asGarmentCategory(category)) {
    case 'bottom':
      return 'lower';
    case 'dress':
      return 'dress';
    case 'shoes':
      return 'shoes';
    case 'bag':
    case 'accessory':
      return 'accessory';
    default:
      return 'upper';
  }
}

/**
 * Body-order frames of 21c, measured on the 169 × 210 lookbook card and a little larger than the board's vector
 * shapes (a photograph has a margin around the garment): top upper-left, bottom right, shoes at the foot, the small
 * pieces in the free corners.
 */
const FL = {
  upper: { x: 0.04, y: 0.05, w: 0.6, h: 0.44, rotate: -6 },
  /** A second upper (top under an open jacket) lies on the first, smaller. */
  upperLayer: { x: 0.17, y: 0.13, w: 0.44, h: 0.34, rotate: 3 },
  right: { x: 0.54, y: 0.26, w: 0.38, h: 0.56, rotate: 4 },
  /** A dress without a top takes the left / centre, tall. */
  dressTall: { x: 0.08, y: 0.04, w: 0.5, h: 0.68, rotate: -4 },
  shoes: { x: 0.05, y: 0.76, w: 0.46, h: 0.18, rotate: -3 },
} satisfies Record<string, FlatlayFrame>;
/** Free corners for accessories (and any piece whose zone is taken), first come first served. */
const FL_FREE_RIGHT_TAKEN: FlatlayFrame[] = [
  { x: 0.66, y: 0.05, w: 0.28, h: 0.2, rotate: 6 },
  { x: 0.66, y: 0.73, w: 0.27, h: 0.21, rotate: 8 },
  { x: 0.42, y: 0.8, w: 0.2, h: 0.15, rotate: -4 },
];
const FL_FREE_RIGHT_OPEN: FlatlayFrame[] = [
  { x: 0.6, y: 0.27, w: 0.32, h: 0.22, rotate: 10 },
  { x: 0.66, y: 0.58, w: 0.26, h: 0.2, rotate: 0 },
  { x: 0.66, y: 0.05, w: 0.28, h: 0.2, rotate: -8 },
];
const FL_FREE_UPPER: FlatlayFrame = { x: 0.08, y: 0.08, w: 0.44, h: 0.34, rotate: -6 };
const FL_FREE_SHOES: FlatlayFrame = { x: 0.1, y: 0.76, w: 0.3, h: 0.18, rotate: -3 };
/** With 5+ pieces the accessories shrink to this, around their centre. */
const FL_SMALL = 0.75;

function shrink(f: FlatlayFrame): FlatlayFrame {
  const w = f.w * FL_SMALL;
  const h = f.h * FL_SMALL;
  return { ...f, x: f.x + (f.w - w) / 2, y: f.y + (f.h - h) / 2, w, h };
}

/**
 * The flat-lay of a look's pieces (canvas 21c), in paint order (bottom / dress first, the upper over it, shoes,
 * then the small pieces). A dress takes the tall left frame when there is no upper, else the bottom's. Pieces that
 * find no frame (beyond seven) are left out.
 */
export function flatlayLayout(categories: readonly (string | null | undefined)[]): FlatlaySpot[] {
  const buckets = categories.map(flatlayBucket);
  const of = (b: FlatlayBucket) => buckets.flatMap((bucket, index) => (bucket === b ? [index] : []));
  const uppers = of('upper');
  // The outerwear is the base layer, the top lies on it.
  uppers.sort((a, b) => Number(asGarmentCategory(categories[b]) === 'outerwear') - Number(asGarmentCategory(categories[a]) === 'outerwear'));
  const dresses = of('dress');
  const lowers = of('lower');
  const shoes = of('shoes');
  const overflow: number[] = [];
  const spots: FlatlaySpot[] = [];
  const place = (index: number | undefined, frame: FlatlayFrame) => {
    if (index !== undefined) spots.push({ index, bucket: buckets[index] ?? 'accessory', frame, small: false });
  };

  const tallDress = uppers.length === 0 ? dresses.shift() : undefined;
  const rightPiece = lowers.shift() ?? dresses.shift();
  overflow.push(...uppers.slice(2), ...lowers, ...dresses, ...shoes.slice(1));
  place(rightPiece, FL.right);
  place(tallDress, FL.dressTall);
  place(uppers[0], FL.upper);
  place(uppers[1], FL.upperLayer);
  place(shoes[0], FL.shoes);

  const free = [...(rightPiece !== undefined ? FL_FREE_RIGHT_TAKEN : FL_FREE_RIGHT_OPEN)];
  if (uppers.length === 0 && tallDress === undefined) free.unshift(FL_FREE_UPPER);
  if (shoes.length === 0) free.push(FL_FREE_SHOES);
  const small = categories.length >= 5;
  [...overflow.sort((a, b) => a - b), ...of('accessory')].forEach((index, i) => {
    const frame = free[i];
    if (frame) spots.push({ index, bucket: buckets[index] ?? 'accessory', frame: small ? shrink(frame) : frame, small });
  });
  return spots;
}

const pct = (n: number) => `${Math.round(n * 1000) / 10}%` as const;

/** Soft drop shadow under a piece: follows the cut-out photograph's outline on iOS, a drop-shadow filter on Android. */
function useFlatlayShadow(): ViewStyle {
  const colors = useThemeColors();
  return Platform.OS === 'android'
    ? { filter: [{ dropShadow: { offsetX: 0, offsetY: 3, standardDeviation: 4, color: `${colors.ink}24` } }] }
    : { shadowColor: colors.ink, shadowOpacity: 0.14, shadowRadius: 4, shadowOffset: { width: 0, height: 4 } };
}

function FlatlayPiece({ piece, spot, shadow }: { piece: Piece; spot: FlatlaySpot; shadow: ViewStyle }) {
  const { frame } = spot;
  return (
    <View
      accessible={false}
      pointerEvents="none"
      testID={`flatlay-${spot.bucket}${spot.small ? '-small' : ''}`}
      className={`absolute ${piece.missing ? 'rounded-image border-[1.5px] border-dashed border-accent' : ''}`}
      style={[{ left: pct(frame.x), top: pct(frame.y), width: pct(frame.w), height: pct(frame.h), transform: [{ rotate: `${frame.rotate}deg` }] }, shadow]}
    >
      <ImageSlot
        uri={piece.imageUrl}
        cacheKey={piece.cacheKey}
        onExpired={piece.onExpired}
        fit="contain"
        transparent
        className={piece.imageUrl ? 'h-full w-full' : 'h-full w-full rounded-image'}
        placeholder={{ kind: 'garment', category: piece.category, color: piece.color, glyphSize: '56%' }}
      />
      {piece.missing ? <MissingTag short className="absolute right-1 top-1" /> : null}
    </View>
  );
}

/**
 * A look cover without a rendered image (canvas 21c "Looklar · flat-lay"): the pieces' background-removed photographs
 * (or each piece's glyph on its colour) laid out flat in body order on the look's ground, slightly tilted, each with a
 * soft shadow. Sized in percentages of the cover, so it needs no measuring at any size.
 */
export function PieceFlatlay({ pieces, seed }: { pieces: Piece[]; seed?: string }) {
  const ground = useGround(toneFromSeed(seed));
  const shadow = useFlatlayShadow();
  const spots = flatlayLayout(pieces.map((p) => p.category));
  return (
    <View className="h-full w-full" style={{ backgroundColor: ground.backgroundColor }} testID="image-slot-flatlay">
      {spots.map((spot) => {
        const piece = pieces[spot.index];
        return piece ? <FlatlayPiece key={spot.index} piece={piece} spot={spot} shadow={shadow} /> : null;
      })}
    </View>
  );
}

function AvatarPlaceholder({ name }: { name: string | null | undefined }) {
  const [size, setSize] = useState(0);
  const initials = initialsOf(name);
  return (
    <View className="h-full w-full items-center justify-center bg-sand" onLayout={(e) => setSize(e.nativeEvent.layout.width)} testID="image-slot-avatar">
      {size > 0 || initials ? (
        <RNText
          accessible={false}
          allowFontScaling={false}
          className="font-sans-medium text-ink"
          style={{ fontSize: Math.max(11, Math.round((size || 40) * 0.36)) }}
        >
          {initials}
        </RNText>
      ) : null}
    </View>
  );
}

function Placeholder({ spec }: { spec: SlotPlaceholder }) {
  switch (spec.kind) {
    case 'garment':
      return <GarmentPlaceholder category={spec.category} subcategory={spec.subcategory} color={spec.color} glyphSize={spec.glyphSize} />;
    case 'avatar':
      return <AvatarPlaceholder name={spec.name} />;
    case 'look':
      return spec.pieces.length === 0 ? (
        <FigurePlaceholder tone={toneFromSeed(spec.seed)} figureHeight={spec.figureHeight} />
      ) : spec.layout === 'flatlay' && (spec.figureHeight ?? 999) >= 80 ? (
        <PieceFlatlay pieces={spec.pieces} seed={spec.seed} />
      ) : (
        <PieceCollage pieces={spec.pieces} compact={(spec.figureHeight ?? 999) < 80} />
      );
    case 'figure':
      return <FigurePlaceholder tone={spec.tone ?? toneFromSeed(spec.seed)} figureHeight={spec.figureHeight} />;
  }
}

type Props = {
  uri?: string | null;
  /**
   * Stable expo-image `cacheKey` / `recyclingKey` (e.g. `${imageCacheKey}:256`, `tryon:${id}`): the disk cache is
   * keyed by it instead of the URL, so a presigned URL whose signature changes on every fetch still hits the cache.
   */
  cacheKey?: string | null;
  /**
   * Called ONCE per mount when the picture fails to load (an expired presigned URL). It may answer a fresh URL,
   * which is loaded with the same `cacheKey`; or nothing, when the owner re-renders with a new `uri` (an
   * invalidated query). A second failure keeps the placeholder.
   */
  onExpired?: ImageRefresh;
  /** What to draw while there is no picture (or it failed to load). Defaults to the standing figure. */
  placeholder?: SlotPlaceholder;
  /** Size / aspect / radius, e.g. `aspect-[4/5] w-full rounded-image-lg`. */
  className?: string;
  accessibilityLabel?: string;
  /** Overlays (tags, heart). */
  children?: ReactNode;
  testID?: string;
  /** The picture arrived / could not be loaded (e.g. an expired presigned URL: the caller fetches a fresh one). */
  onLoad?: () => void;
  onError?: () => void;
  /**
   * `cover` (default) fills the slot; `contain` shows the whole picture. A generated "Üzerimde gör" image is
   * always `contain`: the person is shown whole, head to feet, whatever the slot's shape.
   */
  fit?: 'cover' | 'contain';
  /** No sand ground and no skeleton (a cut-out piece lying on a flat-lay): the photograph fades in on what is under it. */
  transparent?: boolean;
};

export function ImageSlot({
  uri,
  cacheKey,
  onExpired,
  placeholder = { kind: 'figure' },
  className,
  accessibilityLabel,
  children,
  testID,
  onLoad,
  onError,
  fit = 'cover',
  transparent = false,
}: Props) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const [loadedUri, setLoadedUri] = useState<string | null>(null);
  // A fresh URL answered by `onExpired` for the `uri` it replaced (a new `uri` from the owner wins).
  const [fresh, setFresh] = useState<{ from: string; uri: string } | null>(null);
  const refreshed = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const current = uri && fresh?.from === uri ? fresh.uri : (uri ?? null);
  const showImage = Boolean(current) && failedUri !== current;
  const loading = showImage && loadedUri !== current;

  const expired = () => {
    if (!onExpired || refreshed.current || !uri) return;
    refreshed.current = true;
    const from = uri;
    Promise.resolve()
      .then(onExpired)
      .then((next) => {
        if (mounted.current && typeof next === 'string' && next) setFresh({ from, uri: next });
      })
      .catch(() => undefined);
  };

  return (
    <View
      testID={testID}
      className={`overflow-hidden ${transparent ? '' : 'bg-sand'} ${className ?? ''}`}
      accessible={Boolean(accessibilityLabel)}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
    >
      {showImage && current ? (
        <>
          {loading && !transparent ? (
            <View className="absolute inset-0" testID="image-slot-loading">
              <Skeleton className="h-full w-full" />
            </View>
          ) : null}
          <Image
            testID="image-slot-image"
            source={cacheKey ? { uri: current, cacheKey } : { uri: current }}
            recyclingKey={cacheKey ?? current}
            contentFit={fit}
            className="h-full w-full"
            transition={200}
            cachePolicy="memory-disk"
            onLoad={() => {
              setLoadedUri(current);
              onLoad?.();
            }}
            onError={() => {
              setFailedUri(current);
              onError?.();
              expired();
            }}
          />
        </>
      ) : (
        <Placeholder spec={placeholder} />
      )}
      {children}
    </View>
  );
}
