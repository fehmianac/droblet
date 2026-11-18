import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AiBadge } from '@/components/ui/AiBadge';
import { ImageSlot, type Piece } from '@/components/ui/ImageSlot';
import { Text } from '@/components/ui/Text';

type Props = {
  /** Owner-only try-on image; null until one is generated. */
  uri: string | null;
  /** Size, flex and radius (the 06 card and the 08 hero draw it square-cornered, edge to edge). */
  className?: string;
  /** The look's pieces — drawn as the piece collage ("Parça kolajı", 17b) while there is no generated image. */
  pieces: Piece[];
  /** Look id: ground of the standing figure when the look has no pieces at all. */
  seed?: string;
  /** Height of that standing figure. */
  silhouetteHeight: number;
  /** Label of the generated image. */
  accessibilityLabel?: string;
  /** Label of the collage that stands in for it. */
  collageLabel?: string;
  /** Where the "Parça kolajı" badge sits (default top-left; 08 keeps the top free for the header buttons). */
  badgeClassName?: string;
  /** Where the action sits (default: along the foot). */
  ctaClassName?: string;
  /** The call to action of the state without an image (add a photo / add credits / "Üzerimde gör"), laid over the collage's foot. */
  children?: ReactNode;
};

/**
 * The "SENİN ÜZERİNDE" area of 06, 08 and 17. With a generated image: the image and the AI marker
 * bottom-left (always on — AI output is marked). Without one nothing was generated, so there is no
 * marker and never an empty box: the look's piece collage with the "Parça kolajı" badge, and the
 * state's action on top of it.
 */
export function OnYouImage({
  uri,
  className,
  pieces,
  seed,
  silhouetteHeight,
  accessibilityLabel,
  collageLabel,
  badgeClassName = 'left-3.5 top-3.5',
  ctaClassName = 'bottom-2 left-2 right-2',
  children,
}: Props) {
  const { t } = useTranslation();
  return (
    <View className={`overflow-hidden ${className ?? ''}`}>
      <ImageSlot
        uri={uri}
        className="h-full w-full"
        accessibilityLabel={uri ? accessibilityLabel : (collageLabel ?? accessibilityLabel)}
        placeholder={{ kind: 'look', pieces, seed, figureHeight: silhouetteHeight }}
      />
      {uri ? (
        <View className="absolute bottom-2 left-2" pointerEvents="none" testID="on-you-tag">
          <AiBadge kind="onYou" />
        </View>
      ) : (
        <>
          {pieces.length > 0 ? (
            <View
              className={`absolute h-badge justify-center rounded-pill border border-line bg-paper px-2 ${badgeClassName}`}
              pointerEvents="none"
              testID="on-you-collage-badge"
            >
              <Text variant="badge" numberOfLines={1}>
                {t('stylistResult.collageBadge')}
              </Text>
            </View>
          ) : null}
          {children ? (
            <View className={`absolute ${ctaClassName}`} pointerEvents="box-none">
              {children}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}
