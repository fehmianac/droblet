import { Image } from 'expo-image';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { ItemCategory, ItemColor } from '@/api/contracts/wardrobe';
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
 * - look / outfit without a rendered image → a collage of its pieces (canvas "Parça kolajı", 17b);
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
};

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

export type SlotPlaceholder =
  | { kind: 'garment'; category?: string | null; color?: string | null; glyphSize?: number }
  | { kind: 'look'; pieces: Piece[]; seed?: string; figureHeight?: number }
  | { kind: 'avatar'; name: string | null | undefined }
  | { kind: 'figure'; seed?: string; tone?: SlotTone; figureHeight?: number };

function useGround(tone: SlotTone): { backgroundColor: string; ink: 'ink' | 'cream' } {
  const colors = useThemeColors();
  return { backgroundColor: tone === 'sand' ? colors.sand : placeholderTones[tone], ink: tone === 'dark' ? 'cream' : 'ink' };
}

/** The category's line glyph on its own. Decorative. */
export function GarmentGlyph({ category, size = 32, tone = 'ink', opacity = 0.5 }: { category: ItemCategory; size?: number; tone?: 'ink' | 'cream'; opacity?: number }) {
  const colors = useThemeColors();
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" opacity={opacity} accessible={false}>
      <Path d={GARMENT_GLYPHS[category]} fill="none" stroke={colors[tone]} strokeWidth={1.1} strokeLinejoin="round" />
    </Svg>
  );
}

function GarmentPlaceholder({ category, color, glyphSize }: { category?: string | null; color?: string | null; glyphSize?: number }) {
  const ground = useGround(TONE_BY_COLOR[asGarmentColor(color)]);
  return (
    <View className="h-full w-full items-center justify-center" style={{ backgroundColor: ground.backgroundColor }} testID="image-slot-garment">
      <GarmentGlyph category={asGarmentCategory(category)} size={glyphSize} tone={ground.ink} />
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
      return <GarmentPlaceholder category={spec.category} color={spec.color} glyphSize={spec.glyphSize} />;
    case 'avatar':
      return <AvatarPlaceholder name={spec.name} />;
    case 'look':
      return spec.pieces.length > 0 ? (
        <PieceCollage pieces={spec.pieces} compact={(spec.figureHeight ?? 999) < 80} />
      ) : (
        <FigurePlaceholder tone={toneFromSeed(spec.seed)} figureHeight={spec.figureHeight} />
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
      className={`overflow-hidden bg-sand ${className ?? ''}`}
      accessible={Boolean(accessibilityLabel)}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
    >
      {showImage && current ? (
        <>
          {loading ? (
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
