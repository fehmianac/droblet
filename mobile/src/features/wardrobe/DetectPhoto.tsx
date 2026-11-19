import { Image } from 'expo-image';
import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import type { DraftBox } from '@/api/contracts/wardrobe';
import { AiScanLine, brandEasing } from '@/components/ui/ai';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { boxTones, motion, placeholderTones } from '@/theme/tokens';
import { useThemeColors } from '@/theme/useThemeColors';

import { boxRevealDelays, CHIP_HEIGHT, placeChips, type ChipPlacement } from './detect';

export type PhotoPiece = { id: string; index: number; box: DraftBox; label: string };

type Props = {
  uri: string | null;
  /** width / height of the photo; the frame takes it so the boxes land on the pieces. */
  aspect: number;
  /** Pieces with a box (none while the photo is analysed). */
  pieces: PhotoPiece[];
  selection: Set<string>;
  /** The AI is still looking: the scan line of 12 sweeps over the photo. */
  scanning: boolean;
  /** Boxes appear one by one (the user watched the wait); otherwise all at once. */
  stagger: boolean;
  /** Small status tag in the lower-left corner (nothing found / could not be processed). */
  status?: { icon: LucideIcon; label: string } | null;
  accessibilityLabel: string;
  /** The image's own size once it loaded (used when the draft has no `photoSize` yet). */
  onAspect?: (ratio: number) => void;
};

function chipPosition(placement: ChipPlacement) {
  switch (placement) {
    case 'below':
      return { left: -2, bottom: -(CHIP_HEIGHT + 2) };
    case 'above':
      return { left: -2, top: -(CHIP_HEIGHT + 2) };
    case 'inside-bottom':
      return { left: -2, bottom: -2 };
    default:
      return { left: -2, top: -2 };
  }
}

function PhotoBox({ piece, selected, placement, delayMs, animate }: { piece: PhotoPiece; selected: boolean; placement: ChipPlacement; delayMs: number; animate: boolean }) {
  const colors = useThemeColors();
  const v = useSharedValue(animate ? 0 : 1);
  useEffect(() => {
    v.set(animate ? withDelay(delayMs, withTiming(1, { duration: motion.boxInMs, easing: brandEasing })) : 1);
  }, [animate, delayMs, v]);
  const style = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ scale: 0.92 + 0.08 * v.value }] }));
  return (
    <Animated.View
      pointerEvents="none"
      testID={`detect-box-${piece.index}`}
      style={[
        styles.box,
        {
          left: `${piece.box.x * 100}%`,
          top: `${piece.box.y * 100}%`,
          width: `${piece.box.width * 100}%`,
          height: `${piece.box.height * 100}%`,
          borderColor: selected ? colors.ink : boxTones.lineLight,
        },
        style,
      ]}
    >
      <View style={[styles.ring, { borderColor: selected ? boxTones.ringLight : boxTones.ringDark }]} />
      <View
        className={`absolute h-5 max-w-[140px] flex-row items-center rounded-[5px] px-1.5 ${selected ? 'bg-ink' : 'bg-paper'}`}
        style={chipPosition(placement)}
        testID={`detect-chip-${piece.index}`}
      >
        <Text variant="bodyMedium" tone={selected ? 'cream' : 'ink'} className="text-[11px] leading-[14px]" numberOfLines={1}>
          {piece.label}
        </Text>
      </View>
    </Animated.View>
  );
}

/**
 * The user's own photo, the same from 12 to the choice (canvas `ParcaSecAraniyor` → `ParcaSecBeliriyor` →
 * `ParcaSecSecim`): cover-fit on the dark frame tone, the scan line while the AI looks, then a box with a
 * "N · tür" chip per piece, fading and scaling in 120 ms apart. Chips avoid each other (`placeChips`).
 */
export function DetectPhoto({ uri, aspect, pieces, selection, scanning, stagger, status, accessibilityLabel, onAspect }: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const delays = boxRevealDelays(pieces.length, stagger);
  const placements = useMemo(
    () =>
      size.width > 0
        ? placeChips(
            pieces.map((p) => p.box),
            pieces.map((p) => p.label),
            size.width,
            size.height,
          )
        : pieces.map(() => 'inside-top' as const),
    [pieces, size.height, size.width],
  );
  const onLayout = (e: LayoutChangeEvent) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });

  return (
    <View
      className="w-full max-w-[300px] self-center overflow-hidden rounded-image-lg"
      style={{ aspectRatio: aspect, backgroundColor: placeholderTones.dark }}
      onLayout={onLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      testID="detect-photo"
    >
      {uri ? (
        <Image
          source={{ uri }}
          contentFit="cover"
          style={StyleSheet.absoluteFill}
          onLoad={(e) => {
            if (onAspect && e.source.width > 0 && e.source.height > 0) onAspect(e.source.width / e.source.height);
          }}
          testID="detect-photo-image"
        />
      ) : null}
      <AiScanLine active={scanning} />
      {pieces.map((piece, i) => (
        <PhotoBox key={piece.id} piece={piece} selected={selection.has(piece.id)} placement={placements[i] ?? 'inside-top'} delayMs={delays[i] ?? 0} animate={stagger} />
      ))}
      {status ? (
        <View className="absolute bottom-3 left-3 h-7 flex-row items-center gap-1.5 rounded-[8px] bg-paper/95 px-2.5" testID="detect-photo-status">
          <Icon icon={status.icon} size={13} />
          <Text variant="eyebrow" tone="ink" numberOfLines={1}>
            {status.label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: 'absolute', borderWidth: 2, borderRadius: 6 },
  ring: { position: 'absolute', top: -3, left: -3, right: -3, bottom: -3, borderWidth: 1, borderRadius: 8 },
});
